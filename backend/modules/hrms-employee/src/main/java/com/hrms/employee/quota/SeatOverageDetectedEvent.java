package com.hrms.employee.quota;

import java.util.UUID;

/**
 * Fired by {@link SeatQuotaService#getUsage(java.util.UUID)} whenever the
 * workspace's active employee count exceeds its paid seat cap.
 *
 * <p>Published from the seat-quota read path (which the dashboard's
 * Seats-Usage tile polls every 30 seconds), consumed by a listener in the
 * hrms-api module that owns the actual notification fan-out. The event lives
 * here because {@code hrms-employee} does NOT depend on
 * {@code platform-notifications} / {@code platform-saas}: an in-process
 * {@code ApplicationEvent} keeps the write-through split of concerns clean
 * while letting a bean that DOES have those deps do the work.
 *
 * <p>Only fired for {@code purchased &gt; 0 && current &gt; purchased}. Tenants
 * with no plan on file, or exactly at cap, are not our concern here — either
 * the normal onboarding copy or the {@code SeatQuotaEnforcer}'s 402 handles
 * them. The receiver still de-duplicates per (tenant, calendar month) so
 * every dashboard poll for the rest of the month is a no-op.
 */
public record SeatOverageDetectedEvent(UUID tenantId, int purchased, int current) { }
