package com.unifiedtree.saas.controller;

import com.unifiedtree.saas.dto.AccountDtos.AccountLoginRequest;
import com.unifiedtree.saas.dto.AccountDtos.AccountLoginResponse;
import com.unifiedtree.saas.dto.AccountDtos.CreateWorkspaceRequest;
import com.unifiedtree.saas.dto.AccountDtos.WorkspaceSessionRequest;
import com.unifiedtree.saas.dto.AccountDtos.WorkspaceSessionResponse;
import com.unifiedtree.saas.dto.AccountDtos.WorkspaceSummary;
import com.unifiedtree.saas.dto.SaasDtos.SignupResponse;
import com.unifiedtree.saas.service.AccountService;
import jakarta.validation.Valid;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * Global account portal and workspace switcher.
 *
 * <p>Flow:
 * <ol>
 *   <li>POST /v1/accounts/auth/login -> account token + workspace list.</li>
 *   <li>POST /v1/accounts/workspaces -> create another owned workspace.</li>
 *   <li>POST /v1/accounts/workspaces/session -> tenant ERP token.</li>
 *   <li>GET /v1/workspace/context -> app-shell module dashboard metadata.</li>
 * </ol>
 */
@RestController
public class AccountController {

    private final AccountService accounts;

    public AccountController(AccountService accounts) {
        this.accounts = accounts;
    }

    @PostMapping("/v1/accounts/auth/login")
    public AccountLoginResponse login(@Valid @RequestBody AccountLoginRequest request) {
        return accounts.login(request.email(), request.password());
    }

    @GetMapping("/v1/accounts/me/workspaces")
    @PreAuthorize("hasRole('ACCOUNT_USER')")
    public List<WorkspaceSummary> workspaces(@AuthenticationPrincipal Jwt jwt) {
        return accounts.workspaces(jwt);
    }

    @PostMapping("/v1/accounts/workspaces")
    @PreAuthorize("hasRole('ACCOUNT_USER')")
    public SignupResponse createWorkspace(@AuthenticationPrincipal Jwt jwt,
                                          @Valid @RequestBody CreateWorkspaceRequest request) {
        return accounts.createWorkspace(jwt, request);
    }

    @PostMapping("/v1/accounts/workspaces/session")
    @PreAuthorize("hasRole('ACCOUNT_USER')")
    public WorkspaceSessionResponse session(@AuthenticationPrincipal Jwt jwt,
                                            @Valid @RequestBody WorkspaceSessionRequest request) {
        return accounts.createWorkspaceSession(jwt, request.tenantId());
    }

    @GetMapping("/v1/workspace/context")
    @PreAuthorize("hasAuthority('workspace.context.read')")
    public WorkspaceSummary currentWorkspace(@AuthenticationPrincipal Jwt jwt) {
        return accounts.currentWorkspace(jwt);
    }

    @PostMapping("/v1/workspace/modules/{moduleKey}/request-upgrade")
    @PreAuthorize("hasAuthority('workspace.modules.buy')")
    public WorkspaceSummary requestUpgrade(@AuthenticationPrincipal Jwt jwt,
                                           @PathVariable String moduleKey) {
        return accounts.requestModuleUpgrade(jwt, moduleKey);
    }
}
