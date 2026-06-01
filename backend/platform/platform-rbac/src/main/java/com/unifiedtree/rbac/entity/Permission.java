package com.unifiedtree.rbac.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.Setter;

/**
 * Permission catalog row. Pure catalog: code is the primary key, no
 * tenant scoping, no audit columns. The permission set is part of the
 * platform contract; tenants do not create their own permissions.
 *
 * Codes follow the dotted convention: module.entity.action -- e.g.
 * "hrms.employee.read", "leave.request.approve". The convention is
 * enforced by humans during migration review, not by the database.
 */
@Entity
@Table(schema = "rbac", name = "permissions")
@Getter
@Setter
public class Permission {

    @Id
    @Column(name = "code", length = 100, nullable = false)
    private String code;

    @Column(name = "display_name", length = 150, nullable = false)
    private String displayName;

    @Column(name = "module", length = 50, nullable = false)
    private String module;

    @Column(name = "description")
    private String description;
}
