package com.hrms.api.ess;

/**
 * One source of a self-service Home list (my requests, needs you, around you).
 * Each source is one small class: its key, the workspace module its own pages
 * sit behind, the permission its own list endpoint needs, and its query.
 * {@link EssSourceRunner} skips a source the caller may not see or whose module
 * is off, and runs every other one on its own, so one failing source is
 * reported and the rest still answer.
 */
public interface EssSource {

    /** A short upper-case key, reported in {@code unavailable} when the source fails. */
    String key();

    /**
     * The module its pages and endpoints sit behind ({@code TenantModuleGuard}:
     * "hrms", "attendance", "leave", "payroll"), or null when none.
     */
    String module();

    /**
     * Whether the caller may see this source at all. Always the permission its
     * own list endpoint already applies, so Home is never looser than the page
     * it links to.
     */
    boolean allowed(EssCaller caller);
}
