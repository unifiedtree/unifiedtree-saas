package com.hrms.api.auth;

import com.hrms.auth.dto.AuthResponse;
import com.hrms.auth.dto.LoginRequest;
import com.hrms.auth.dto.MobileOtpRequest;
import com.hrms.auth.dto.MobileOtpResponse;
import com.hrms.auth.dto.RefreshRequest;
import com.hrms.auth.dto.VerifyOtpRequest;
import com.hrms.auth.service.AuthService;
import com.hrms.api.saas.SaasPlatformService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.*;

import java.util.UUID;

@RestController
@RequestMapping("/v1/auth")
@Tag(name = "Authentication", description = "Login, token refresh, and logout")
public class AuthController {

    private final AuthService authService;
    private final SaasPlatformService saasPlatformService;

    public AuthController(AuthService authService, SaasPlatformService saasPlatformService) {
        this.authService = authService;
        this.saasPlatformService = saasPlatformService;
    }

    @Operation(summary = "Login with email + password (+ optional MFA code)")
    @PostMapping("/login")
    public ResponseEntity<AuthResponse> login(
            @Valid @RequestBody LoginRequest request,
            @RequestHeader(value = "X-Tenant-ID", required = false) String tenantId,
            @RequestHeader(value = "X-Tenant-Subdomain", required = false) String subdomain,
            @RequestHeader(value = "Host", required = false) String host) {
        return ResponseEntity.ok(authService.login(
                request,
                saasPlatformService.resolveTenantId(tenantId, subdomain, host)));
    }

    @Operation(summary = "Request mobile OTP for employee/manager app login")
    @PostMapping("/mobile/request-otp")
    public ResponseEntity<MobileOtpResponse> requestMobileOtp(
            @Valid @RequestBody MobileOtpRequest request,
            @RequestHeader(value = "X-Tenant-ID", required = false) String tenantId,
            @RequestHeader(value = "X-Tenant-Subdomain", required = false) String subdomain,
            @RequestHeader(value = "Host", required = false) String host) {
        return ResponseEntity.ok(authService.requestMobileOtp(
                request,
                saasPlatformService.resolveTenantId(tenantId, subdomain, host)));
    }

    @Operation(summary = "Verify mobile OTP and return JWT tokens")
    @PostMapping("/mobile/verify-otp")
    public ResponseEntity<AuthResponse> verifyMobileOtp(
            @Valid @RequestBody VerifyOtpRequest request,
            @RequestHeader(value = "X-Tenant-ID", required = false) String tenantId,
            @RequestHeader(value = "X-Tenant-Subdomain", required = false) String subdomain,
            @RequestHeader(value = "Host", required = false) String host) {
        return ResponseEntity.ok(authService.verifyMobileOtp(
                request,
                saasPlatformService.resolveTenantId(tenantId, subdomain, host)));
    }

    @Operation(summary = "Refresh access token using a valid refresh token")
    @PostMapping("/refresh")
    public ResponseEntity<AuthResponse> refresh(@Valid @RequestBody RefreshRequest request) {
        return ResponseEntity.ok(authService.refresh(request));
    }

    @Operation(summary = "Logout — revokes all refresh tokens for the current user")
    @PostMapping("/logout")
    @PreAuthorize("isAuthenticated()")
    public ResponseEntity<Void> logout(@AuthenticationPrincipal Jwt jwt) {
        UUID userId = UUID.fromString(jwt.getSubject());
        authService.logout(userId);
        return ResponseEntity.noContent().build();
    }
}
