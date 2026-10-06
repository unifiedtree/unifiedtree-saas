package com.hrms.api.images;

import com.hrms.api.access.RecordCompanyGuard;
import com.hrms.api.workforce.WorkforceAccess;
import com.hrms.core.exception.BusinessRuleException;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

/**
 * Upload and remove an employee photo, a branch logo or an agency logo
 * (V143.102; {@link RecordImageService}). Multipart, one part named {@code file}.
 *
 * <ul>
 *   <li>Employee photo: the person themself (the employee on their sign-in), or
 *       someone with hrms.employee.write who may act in that person's company
 *       (the same check as editing the record).</li>
 *   <li>Branch logo: org.company.write (as editing a branch).</li>
 *   <li>Agency logo: hrms.contractor.write (as editing an agency).</li>
 *   <li>{@code GET /v1/hrms/record-images?kind=branch|agency|employee}: every
 *       image of that kind in the workspace, record id → address, for lists and
 *       pickers. Anyone signed in (photos already show in search and the org
 *       chart; logos are not private).</li>
 * </ul>
 * No new permission.
 */
@RestController
@RequestMapping("/v1/hrms")
public class RecordImageController {

    private final RecordImageService images;
    /** Company access for records addressed by id (COMPANY_ACCESS.md); absent in hand-built unit tests. */
    @Autowired(required = false)
    private RecordCompanyGuard recordGuard;

    public RecordImageController(RecordImageService images) {
        this.images = images;
    }

    // -- employee photo ----------------------------------------------------

    @PostMapping(value = "/employees/{id}/photo", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @PreAuthorize("isAuthenticated()")
    public Map<String, String> uploadPhoto(@PathVariable UUID id, @RequestPart("file") MultipartFile file,
                                           @AuthenticationPrincipal Jwt jwt) throws IOException {
        mayChangePhoto(id, jwt);
        String url = images.put(RecordImageService.Kind.EMPLOYEE, id, bytes(file), actor(jwt));
        return Map.of("url", url, "profilePhotoUrl", url);
    }

    @DeleteMapping("/employees/{id}/photo")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @PreAuthorize("isAuthenticated()")
    public void removePhoto(@PathVariable UUID id, @AuthenticationPrincipal Jwt jwt) {
        mayChangePhoto(id, jwt);
        images.remove(RecordImageService.Kind.EMPLOYEE, id);
    }

    /** Their own photo, or hrms.employee.write in a company they may work in. */
    void mayChangePhoto(UUID employeeId, Jwt jwt) {
        UUID self = WorkforceAccess.employeeId(jwt);
        if (self != null && self.equals(employeeId)) return;
        if (!holds("hrms.employee.write")) {
            throw new AccessDeniedException("You can only change your own photo");
        }
        RecordCompanyGuard.checkEmployee(recordGuard, employeeId);
    }

    // -- branch logo -------------------------------------------------------

    @PostMapping(value = "/branches/{id}/logo", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @PreAuthorize("hasAuthority('org.company.write')")
    public Map<String, String> uploadBranchLogo(@PathVariable UUID id, @RequestPart("file") MultipartFile file,
                                                @AuthenticationPrincipal Jwt jwt) throws IOException {
        RecordCompanyGuard.check(recordGuard, RecordCompanyGuard.Kind.BRANCH, id);
        return Map.of("url", images.put(RecordImageService.Kind.BRANCH, id, bytes(file), actor(jwt)));
    }

    @DeleteMapping("/branches/{id}/logo")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @PreAuthorize("hasAuthority('org.company.write')")
    public void removeBranchLogo(@PathVariable UUID id) {
        RecordCompanyGuard.check(recordGuard, RecordCompanyGuard.Kind.BRANCH, id);
        images.remove(RecordImageService.Kind.BRANCH, id);
    }

    // -- agency logo -------------------------------------------------------

    @PostMapping(value = "/contractors/{id}/logo", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @PreAuthorize("hasAuthority('hrms.contractor.write')")
    public Map<String, String> uploadAgencyLogo(@PathVariable UUID id, @RequestPart("file") MultipartFile file,
                                                @AuthenticationPrincipal Jwt jwt) throws IOException {
        RecordCompanyGuard.check(recordGuard, RecordCompanyGuard.Kind.CONTRACTOR, id);
        return Map.of("url", images.put(RecordImageService.Kind.AGENCY, id, bytes(file), actor(jwt)));
    }

    @DeleteMapping("/contractors/{id}/logo")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @PreAuthorize("hasAuthority('hrms.contractor.write')")
    public void removeAgencyLogo(@PathVariable UUID id) {
        RecordCompanyGuard.check(recordGuard, RecordCompanyGuard.Kind.CONTRACTOR, id);
        images.remove(RecordImageService.Kind.AGENCY, id);
    }

    // -- lists -------------------------------------------------------------

    /** { available, urls: { recordId: address } } — available is false until V143.102 is applied. */
    @GetMapping("/record-images")
    @PreAuthorize("isAuthenticated()")
    public Map<String, Object> list(@RequestParam("kind") String kindRaw) {
        RecordImageService.Kind kind = RecordImageService.Kind.parse(kindRaw);
        if (kind == null) throw new BusinessRuleException("Unknown image kind", "IMAGE_KIND");
        Map<String, String> urls = new LinkedHashMap<>();
        images.urls(kind).forEach((k, v) -> urls.put(k.toString(), v));
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("available", images.available());
        out.put("urls", urls);
        return out;
    }

    // -- helpers -----------------------------------------------------------

    private static byte[] bytes(MultipartFile file) throws IOException {
        if (file == null || file.isEmpty()) throw new BusinessRuleException("Choose an image to upload", "IMAGE_EMPTY");
        if (file.getSize() > RecordImage.MAX_BYTES) throw new BusinessRuleException("The image must be 2 MB or smaller", "IMAGE_TOO_LARGE");
        return file.getBytes();
    }

    static boolean holds(String authority) {
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        return auth != null && auth.getAuthorities().stream().anyMatch(a -> authority.equals(a.getAuthority()));
    }

    private static String actor(Jwt jwt) {
        if (jwt == null) return null;
        Object email = jwt.getClaims().get("email");
        return email != null ? email.toString() : jwt.getSubject();
    }
}
