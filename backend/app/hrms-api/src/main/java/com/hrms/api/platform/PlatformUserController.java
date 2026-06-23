package com.hrms.api.platform;

import com.hrms.auth.entity.UserCredential;
import com.hrms.auth.service.AuthService;
import com.hrms.core.enums.Role;
import com.hrms.core.tenant.TenantContext;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;
import java.util.stream.Collectors;

@RestController
@RequestMapping("/v1/platform/users")
@Tag(name = "Platform Users", description = "Workspace user management (non-HRMS staff)")
public class PlatformUserController {

    private final AuthService authService;

    public PlatformUserController(AuthService authService) {
        this.authService = authService;
    }

    public record CreatePlatformUserRequest(String email, String mobileNumber, String rawPassword, List<Role> roles) {}
    
    public record PlatformUserResponse(UUID id, String email, String mobileNumber, List<Role> roles, boolean active, UUID employeeId) {}

    @Operation(summary = "List all users in the workspace")
    @GetMapping
    @PreAuthorize("hasAuthority('workspace.users.read') or hasAuthority('platform.admin')")
    public ResponseEntity<List<PlatformUserResponse>> listUsers() {
        List<UserCredential> users = authService.listUsersByTenant(TenantContext.getTenantId());
        
        List<PlatformUserResponse> response = users.stream()
                .map(u -> new PlatformUserResponse(
                        u.getId(),
                        u.getEmail(),
                        u.getMobileNumber(),
                        u.getRoles(),
                        u.isActive(),
                        u.getEmployeeId()
                ))
                .collect(Collectors.toList());
                
        return ResponseEntity.ok(response);
    }

    @Operation(summary = "Invite a new non-HRMS user to the workspace")
    @PostMapping
    @PreAuthorize("hasAuthority('workspace.users.manage') or hasAuthority('platform.admin')")
    public ResponseEntity<PlatformUserResponse> createUser(@Valid @RequestBody CreatePlatformUserRequest req) {
        // employeeId is null for pure platform users
        UserCredential created = authService.createOrUpdateCredentialForEmployee(
                TenantContext.getTenantId(),
                null,
                req.email(),
                req.mobileNumber(),
                req.rawPassword() == null || req.rawPassword().isBlank() ? "Welcome@123" : req.rawPassword(),
                req.roles() == null || req.roles().isEmpty() ? List.of(Role.WORKSPACE_USER) : req.roles(),
                false
        );

        return ResponseEntity.status(HttpStatus.CREATED).body(new PlatformUserResponse(
                created.getId(),
                created.getEmail(),
                created.getMobileNumber(),
                created.getRoles(),
                created.isActive(),
                created.getEmployeeId()
        ));
    }
}
