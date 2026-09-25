package com.hrms.api.attendance;

import com.hrms.core.tenant.TenantContext;
import com.unifiedtree.settings.branding.DocumentStorage;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;

import java.io.IOException;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

/**
 * Proof for a regularization ("Ask for a fix") request (V143.10, P0-5).
 *
 * <p>The file goes to the private document bucket ({@link DocumentStorage});
 * the request stores {@code r2://attendance-proofs/<tenant>/<employee>/<id>/<name>}
 * as its {@code attachmentUrl}. The approver opens it through a short-lived
 * signed link from {@code GET /v1/attendance/corrections/{id}/attachment}.
 */
@RestController
@RequestMapping("/v1/attendance/corrections")
public class CorrectionProofController {

    static final long MAX_BYTES = 5L * 1024 * 1024;
    static final String PREFIX = "attendance-proofs/";

    private final DocumentStorage storage;
    private final JdbcTemplate jdbc;
    private final ApproverScopeGuard approverScopeGuard;

    public CorrectionProofController(DocumentStorage storage, JdbcTemplate jdbc, ApproverScopeGuard approverScopeGuard) {
        this.storage = storage;
        this.jdbc = jdbc;
        this.approverScopeGuard = approverScopeGuard;
    }

    public record UploadedProof(String attachmentUrl, String fileName, String contentType, long sizeBytes) {}

    public record ProofLink(String url, String fileName) {}

    @PostMapping(value = "/attachments", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @ResponseStatus(HttpStatus.CREATED)
    @PreAuthorize("hasAuthority('attendance.checkin.self')")
    public UploadedProof upload(@RequestPart("file") MultipartFile file, @AuthenticationPrincipal Jwt jwt) throws IOException {
        if (file == null || file.isEmpty()) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Choose a file to attach.");
        if (file.getSize() > MAX_BYTES) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "The file is too large. Attach a PDF or image up to 5 MB.");
        byte[] bytes = file.getBytes();
        String contentType = contentTypeOf(bytes);
        if (contentType == null) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Attach a PDF, JPG or PNG file.");
        if (!storage.isConfigured()) throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,
                "File storage isn't set up for this workspace yet, so proof can't be attached. Send the request without it, or ask your admin.");
        UUID employeeId = AttendanceReviewService.callerEmployeeId(jwt);
        String name = safeName(file.getOriginalFilename(), extFor(contentType));
        String key = ownPrefix(employeeId) + UUID.randomUUID() + "/" + name;
        storage.put(key, bytes, contentType);
        return new UploadedProof("r2://" + key, name, contentType, bytes.length);
    }

    @GetMapping("/{correctionId}/attachment")
    @PreAuthorize("hasAnyAuthority('attendance.checkin.self', 'attendance.regularization.approve')")
    public ProofLink link(@PathVariable UUID correctionId, @AuthenticationPrincipal Jwt jwt, Authentication auth) {
        List<Object[]> rows = jdbc.query("SELECT employee_id, attachment_url FROM attendance.regularization_requests WHERE id = ?",
                (rs, i) -> new Object[]{rs.getObject("employee_id"), rs.getString("attachment_url")}, correctionId);
        if (rows.isEmpty()) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Fix request not found.");
        UUID owner = (UUID) rows.get(0)[0];
        String url = (String) rows.get(0)[1];
        if (!owner.equals(AttendanceReviewService.callerEmployeeId(jwt))) {
            boolean approver = auth != null && auth.getAuthorities().stream().anyMatch(a -> "attendance.regularization.approve".equals(a.getAuthority()));
            if (!approver) throw new AccessDeniedException("You can open only your own proof.");
            approverScopeGuard.assertCanDecideFor(owner, jwt, auth);
        }
        if (url == null || url.isBlank()) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "This request has no proof attached.");
        if (!url.startsWith("r2://")) return new ProofLink(url, lastSegment(url));
        if (!storage.isConfigured()) throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,
                "File storage isn't set up for this workspace, so the proof can't be opened.");
        return new ProofLink(storage.urlFor(url.substring(5)), lastSegment(url));
    }

    /** Where this employee's proofs live; a request may only point inside it. */
    static String ownPrefix(UUID employeeId) {
        return PREFIX + TenantContext.getTenantId() + "/" + employeeId + "/";
    }

    /**
     * Null when the link is acceptable for {@code employeeId}'s request, else the
     * message to show. Accepts no link, an https / http link (older clients), or
     * a proof this employee uploaded.
     */
    static String attachmentProblem(String url, String ownPrefix) {
        if (url == null || url.isBlank()) return null;
        String u = url.trim();
        if (u.startsWith("r2://")) return u.startsWith("r2://" + ownPrefix) && !u.contains("..") ? null
                : "That proof file isn't yours. Attach it again.";
        String lower = u.toLowerCase(Locale.ROOT);
        return lower.startsWith("https://") || lower.startsWith("http://") ? null : "The proof must be an uploaded file or a web link.";
    }

    static String contentTypeOf(byte[] b) {
        if (b.length >= 5 && b[0] == '%' && b[1] == 'P' && b[2] == 'D' && b[3] == 'F' && b[4] == '-') return "application/pdf";
        if (b.length >= 8 && (b[0] & 255) == 137 && b[1] == 80 && b[2] == 78 && b[3] == 71) return "image/png";
        if (b.length >= 3 && (b[0] & 255) == 255 && (b[1] & 255) == 216 && (b[2] & 255) == 255) return "image/jpeg";
        return null;
    }

    private static String extFor(String contentType) {
        return switch (contentType) {
            case "application/pdf" -> "pdf";
            case "image/png" -> "png";
            default -> "jpg";
        };
    }

    /** A safe file name that ends in the real type's extension. */
    static String safeName(String original, String ext) {
        String base = original == null ? "" : original.replaceAll("^.*[\\\\/]", "");
        int dot = base.lastIndexOf('.');
        if (dot > 0) base = base.substring(0, dot);
        base = base.replaceAll("[^A-Za-z0-9._-]+", "-").replaceAll("-{2,}", "-").replaceAll("^[-.]+|[-.]+$", "");
        if (base.isBlank()) base = "proof";
        if (base.length() > 60) base = base.substring(0, 60);
        return base + "." + ext;
    }

    private static String lastSegment(String url) {
        String u = url.replaceAll("[?#].*$", "");
        int i = u.lastIndexOf('/');
        return i >= 0 && i < u.length() - 1 ? u.substring(i + 1) : "proof";
    }
}
