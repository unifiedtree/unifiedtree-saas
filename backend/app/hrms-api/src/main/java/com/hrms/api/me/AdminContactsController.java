package com.hrms.api.me;

import com.unifiedtree.security.tenant.TenantContext;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * {@code GET /v1/workspace/admin-contacts}: Help &amp; support's list of the people who run this
 * workspace (redesign BW-01, contract C0 {@code useAdminContacts}). Anyone signed in may ask: it only
 * names the workspace's admins and their work email, which every member needs to reach for access.
 */
@RestController
@RequestMapping("/v1/workspace/admin-contacts")
@SecurityRequirement(name = "bearerAuth")
public class AdminContactsController {

    private final AdminContactsService contacts;

    public AdminContactsController(AdminContactsService contacts) {
        this.contacts = contacts;
    }

    @Operation(summary = "The workspace's admins to contact for help: name, work email and role")
    @GetMapping
    @PreAuthorize("isAuthenticated()")
    public List<AdminContactsService.AdminContact> list() {
        return contacts.contacts(TenantContext.getTenantId());
    }
}
