package com.hrms.core.tenant;

import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * Marks a service method (or entire class) as explicitly allowed to bypass the
 * Hibernate tenant filter and query across all tenants.
 *
 * Only SUPER_ADMIN roles should call these endpoints. The annotation does NOT
 * enforce RBAC — that is left to @PreAuthorize on the controller layer.
 */
@Documented
@Target({ElementType.METHOD, ElementType.TYPE})
@Retention(RetentionPolicy.RUNTIME)
public @interface CrossTenant {
}
