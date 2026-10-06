package com.hrms.api.workforce.images;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** V143.102: who may change an employee photo, a branch logo and an agency logo. */
class RecordImageControllerTest {

    private final RecordImageService images = mock(RecordImageService.class);
    private final RecordImageController controller = new RecordImageController(images);
    private final UUID me = UUID.randomUUID();
    private final UUID colleague = UUID.randomUUID();
    private final MockMultipartFile file = new MockMultipartFile("file", "p.png", "image/png", new byte[]{1, 2, 3});

    @AfterEach
    void tearDown() {
        SecurityContextHolder.clearContext();
    }

    private Jwt jwt(UUID employeeId) {
        return Jwt.withTokenValue("t").header("alg", "none").subject("u").claim("email", "me@x.com")
                .claim("employee_id", employeeId.toString()).issuedAt(Instant.now()).expiresAt(Instant.now().plusSeconds(60)).build();
    }

    private static void signInWith(String... permissions) {
        SecurityContextHolder.getContext().setAuthentication(new UsernamePasswordAuthenticationToken("u", null,
                java.util.Arrays.stream(permissions).map(SimpleGrantedAuthority::new).toList()));
    }

    @Test
    void anEmployeeChangesTheirOwnPhoto() throws Exception {
        signInWith("hrms.leave.apply");
        when(images.put(eq(RecordImageService.Kind.EMPLOYEE), eq(me), any(), eq("me@x.com"))).thenReturn("/v1/public/images/t/x");
        Map<String, String> r = controller.uploadPhoto(me, file, jwt(me));
        assertThat(r).containsEntry("url", "/v1/public/images/t/x").containsEntry("profilePhotoUrl", "/v1/public/images/t/x");
        controller.removePhoto(me, jwt(me));
        verify(images).remove(RecordImageService.Kind.EMPLOYEE, me);
    }

    @Test
    void anEmployeeCannotChangeSomeoneElsesPhoto() throws Exception {
        signInWith("hrms.leave.apply");
        assertThatThrownBy(() -> controller.uploadPhoto(colleague, file, jwt(me))).isInstanceOf(AccessDeniedException.class);
        assertThatThrownBy(() -> controller.removePhoto(colleague, jwt(me))).isInstanceOf(AccessDeniedException.class);
        verify(images, never()).put(any(), any(), any(), any());
        verify(images, never()).remove(any(), any());
    }

    @Test
    void hrWithEmployeeWriteChangesAnyonesPhoto() throws Exception {
        signInWith("hrms.employee.write");
        when(images.put(eq(RecordImageService.Kind.EMPLOYEE), eq(colleague), any(), any())).thenReturn("/v1/public/images/t/y");
        assertThat(controller.uploadPhoto(colleague, file, jwt(me))).containsEntry("url", "/v1/public/images/t/y");
    }

    @Test
    void logoEndpointsNeedTheEditPermissionOfTheirRecord() throws Exception {
        PreAuthorize branch = RecordImageController.class.getMethod("uploadBranchLogo", UUID.class, org.springframework.web.multipart.MultipartFile.class, Jwt.class)
                .getAnnotation(PreAuthorize.class);
        PreAuthorize agency = RecordImageController.class.getMethod("uploadAgencyLogo", UUID.class, org.springframework.web.multipart.MultipartFile.class, Jwt.class)
                .getAnnotation(PreAuthorize.class);
        assertThat(branch.value()).isEqualTo("hasAuthority('org.company.write')");
        assertThat(agency.value()).isEqualTo("hasAuthority('hrms.contractor.write')");
        assertThat(RecordImageController.class.getMethod("removeBranchLogo", UUID.class).getAnnotation(PreAuthorize.class).value())
                .isEqualTo("hasAuthority('org.company.write')");
        assertThat(RecordImageController.class.getMethod("removeAgencyLogo", UUID.class).getAnnotation(PreAuthorize.class).value())
                .isEqualTo("hasAuthority('hrms.contractor.write')");
    }

    @Test
    void theListSaysWhetherTheFeatureIsOn() {
        UUID b = UUID.randomUUID();
        when(images.urls(RecordImageService.Kind.BRANCH)).thenReturn(Map.of(b, "/v1/public/images/t/z"));
        when(images.available()).thenReturn(true);
        Map<String, Object> r = controller.list("branch");
        assertThat(r).containsEntry("available", true);
        @SuppressWarnings("unchecked") Map<String, String> urls = (Map<String, String>) r.get("urls");
        assertThat(urls).containsEntry(b.toString(), "/v1/public/images/t/z");
        assertThatThrownBy(() -> controller.list("payslip")).hasMessage("Unknown image kind");
    }

    @Test
    void anOversizedUploadIsRefusedBeforeReading() {
        signInWith("hrms.employee.write");
        MockMultipartFile big = new MockMultipartFile("file", "b.png", "image/png", new byte[(int) RecordImage.MAX_BYTES + 1]);
        assertThatThrownBy(() -> controller.uploadPhoto(colleague, big, jwt(me))).hasMessage("The image must be 2 MB or smaller");
        verify(images, never()).put(any(), any(), any(), any());
    }
}
