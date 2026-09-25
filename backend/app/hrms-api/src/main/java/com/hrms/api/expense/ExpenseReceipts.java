package com.hrms.api.expense;

import com.unifiedtree.settings.branding.DocumentStorage;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;

import java.io.IOException;
import java.util.UUID;
import java.util.regex.Pattern;

/**
 * Expense receipts in the private document bucket (the same R2 storage as
 * employee documents, never the public branding bucket).
 *
 * <p>A receipt is stored at {@code expense-receipts/<tenant>/<employee>/<uuid>.<ext>}
 * and the line item keeps {@code r2://<key>}. The API never hands the key out as a
 * link: reads get a short-lived signed URL, and only for keys under the caller's
 * tenant. A claim may only reference receipts its own claimant uploaded, so one
 * person can't attach (and later read) someone else's file by pasting its key.
 */
@Component
public class ExpenseReceipts {

    static final String PREFIX = "expense-receipts/";
    /** Receipts are photos or PDFs; the multipart limit (10 MB) is the ceiling anyway. */
    static final long MAX_BYTES = 10L * 1024 * 1024;
    private static final Pattern KEY = Pattern.compile(
            "^r2://expense-receipts/([0-9a-fA-F-]{36})/([0-9a-fA-F-]{36})/[0-9a-fA-F-]{36}\\.(pdf|png|jpg)$");

    private final DocumentStorage storage;

    public ExpenseReceipts(DocumentStorage storage) {
        this.storage = storage;
    }

    /** What an upload returns: the stored reference to send back on the claim, and the file's facts. */
    public record Stored(String receiptUrl, String fileName, long sizeBytes, String contentType) {}

    /** Validates (size, real PDF / PNG / JPEG content) and stores one receipt for {@code employeeId}. */
    public Stored store(UUID tenantId, UUID employeeId, MultipartFile file) throws IOException {
        if (file == null || file.isEmpty())
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Choose a receipt file to upload");
        if (file.getSize() > MAX_BYTES)
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "The receipt is too large (max 10 MB)");
        byte[] bytes = file.getBytes();
        String contentType = detectContentType(bytes);
        if (!storage.isConfigured())
            throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,
                    "Receipt storage isn't set up for this workspace yet. Submit without the receipt, or ask your admin to set R2_DOCUMENT_BUCKET.");
        String key = PREFIX + tenantId + "/" + employeeId + "/" + UUID.randomUUID() + "." + extFor(contentType);
        storage.put(key, bytes, contentType);
        return new Stored("r2://" + key, cleanName(file.getOriginalFilename()), file.getSize(), contentType);
    }

    /** True when {@code url} is a receipt this workspace issued to {@code employeeId}. */
    static boolean isOwnedBy(String url, UUID tenantId, UUID employeeId) {
        if (url == null || tenantId == null || employeeId == null) return false;
        var m = KEY.matcher(url);
        return m.matches() && m.group(1).equalsIgnoreCase(tenantId.toString())
                && m.group(2).equalsIgnoreCase(employeeId.toString());
    }

    /** True when {@code url} is a receipt stored under {@code tenantId}. */
    static boolean belongsToTenant(String url, UUID tenantId) {
        if (url == null || tenantId == null) return false;
        var m = KEY.matcher(url);
        return m.matches() && m.group(1).equalsIgnoreCase(tenantId.toString());
    }

    /**
     * The link the browser opens: a signed URL for this workspace's receipts, null
     * when there is no receipt, it isn't this workspace's, or storage isn't set up
     * (the response's hasReceipt still says one is attached).
     */
    public String signedUrl(String stored, UUID tenantId) {
        if (stored == null || stored.isBlank()) return null;
        if (!belongsToTenant(stored, tenantId)) return null;
        if (!storage.isConfigured()) return null;
        return storage.urlFor(stored.substring("r2://".length()));
    }

    /** Best-effort removal of a replaced / orphaned receipt of this workspace. */
    public void deleteQuietly(String stored, UUID tenantId) {
        if (belongsToTenant(stored, tenantId)) storage.deleteQuietly(stored.substring("r2://".length()));
    }

    static String detectContentType(byte[] bytes) {
        if (bytes.length >= 5 && bytes[0] == '%' && bytes[1] == 'P' && bytes[2] == 'D' && bytes[3] == 'F' && bytes[4] == '-') return "application/pdf";
        if (bytes.length >= 8 && (bytes[0] & 255) == 137 && bytes[1] == 80 && bytes[2] == 78 && bytes[3] == 71) return "image/png";
        if (bytes.length >= 3 && (bytes[0] & 255) == 255 && (bytes[1] & 255) == 216 && (bytes[2] & 255) == 255) return "image/jpeg";
        throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "A receipt must be a PDF, PNG or JPEG");
    }

    private static String extFor(String contentType) {
        return switch (contentType) {
            case "application/pdf" -> "pdf";
            case "image/png" -> "png";
            default -> "jpg";
        };
    }

    private static String cleanName(String name) {
        if (name == null || name.isBlank()) return "receipt";
        String base = name.replace('\\', '/');
        base = base.substring(base.lastIndexOf('/') + 1);
        return base.length() > 200 ? base.substring(0, 200) : base;
    }
}
