package com.hrms.employee.quota;

import com.hrms.core.tenant.TenantContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;

/**
 * Single canonical enforcement point for the workspace's paid seat cap.
 *
 * <p>Every code path that inserts a row into {@code hrms.employees} calls
 * {@link #assertCapacity()} (or the batched {@link #assertCapacity(int)})
 * as the first line of its create method:
 * <ul>
 *   <li>{@code EmployeeService.createEmployee} — the legacy REST create
 *       ({@code POST /v1/employees});</li>
 *   <li>{@code WorkforceEmployeeService.create} — the workforce-directory
 *       create ({@code POST /v1/hrms/employees}), which is what the SPA's
 *       "Add Employee" button actually hits;</li>
 *   <li>{@code EmployeeBulkImportService.validateAndCommit} — the CSV/XLSX
 *       bulk upload path, which pre-flights the whole batch size before
 *       inserting the first row.</li>
 * </ul>
 * The previous round of this feature enforced only on the workforce path
 * via a Spring AOP aspect that missed both other paths and fail-opened on
 * any RuntimeException; this class replaces all of that with a plain
 * in-service call so the check is impossible to bypass by picking a
 * different endpoint.
 *
 * <p><b>Race safety.</b> Runs inside the caller's transaction
 * ({@link Propagation#MANDATORY}) and takes a per-tenant advisory lock
 * ({@code pg_advisory_xact_lock}) so two concurrent creates on the same
 * tenant serialize on that key rather than both reading the same "one seat
 * free" snapshot. The lock is released at COMMIT/ROLLBACK — hence why we
 * insist the caller already opened a tx.
 *
 * <p><b>Fail closed.</b> If the quota lookup itself blows up (bad SQL, DB
 * outage, migration drift) we throw {@link SeatLimitExceededException} with
 * code {@link SeatLimitExceededException#CODE_QUOTA_LOOKUP_FAILED} rather
 * than swallow it. Silently allowing creates on a broken quota query is how
 * a workspace paying for 3 seats ends up with 300 free ones — the prior
 * aspect's fail-open path was exactly that mistake.
 *
 * <p><b>Exclusion.</b> Delegates to {@link SeatQuotaService#getUsage(UUID)},
 * which counts active employees whose linked user_credentials row does NOT
 * carry a workspace-admin grant ({@code OWNER} / {@code SUPER_ADMIN} — the
 * only two codes actually seeded in {@code rbac.roles}). Self-onboarded
 * owners created as an employee row are not double-billed.
 */
@Component
public class SeatQuotaEnforcer {

    private static final Logger log = LoggerFactory.getLogger(SeatQuotaEnforcer.class);

    private final SeatQuotaService seatQuota;
    private final JdbcTemplate jdbc;

    public SeatQuotaEnforcer(SeatQuotaService seatQuota, JdbcTemplate jdbc) {
        this.seatQuota = seatQuota;
        this.jdbc = jdbc;
    }

    /** Convenience for the common "creating one" case. */
    public void assertCapacity() {
        assertCapacity(1);
    }

    /**
     * Ensure the current-tenant workspace has room for {@code additional}
     * new seats. No-op for {@code additional <= 0} (dry-run / validate-only
     * paths that want to reuse the same call site).
     *
     * @throws SeatLimitExceededException with code
     *         {@link SeatLimitExceededException#CODE_SEAT_LIMIT_EXCEEDED}
     *         when the workspace is at or past cap (HTTP 402 via
     *         {@link SeatLimitExceptionHandler}), or code
     *         {@link SeatLimitExceededException#CODE_QUOTA_LOOKUP_FAILED}
     *         when the underlying quota query itself failed.
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public void assertCapacity(int additional) {
        if (additional <= 0) return;
        UUID tenantId = TenantContext.getTenantId();
        if (tenantId == null) {
            // Batch/system paths (jobs with no bound tenant) — not our call
            // to police. Caller is responsible for binding the context first.
            return;
        }

        // Serialise concurrent creates on the same tenant so two 199th-and-
        // 200th requests don't both see "1 seat free". Advisory lock is
        // released at COMMIT/ROLLBACK — hence Propagation.MANDATORY above.
        try {
            // pg_advisory_xact_lock returns void — use query() with a no-op
            // extractor so the JDBC driver doesn't complain about missing
            // column metadata. hashtext() over the tenant-scoped key keeps
            // us in the same 32-bit lock namespace regardless of tenant id.
            jdbc.query("SELECT pg_advisory_xact_lock(hashtext(?))",
                    rs -> null, "seat-cap:" + tenantId);
        } catch (RuntimeException e) {
            log.error("SEAT_QUOTA_LOOKUP_FAILED tenant={} taking advisory lock: {}",
                    tenantId, e.toString(), e);
            throw new SeatLimitExceededException(tenantId,
                    SeatLimitExceededException.CODE_QUOTA_LOOKUP_FAILED,
                    "Could not verify seat availability right now. Please retry; "
                            + "contact support if this keeps happening.");
        }

        SeatQuotaService.Usage u;
        try {
            u = seatQuota.getUsage(tenantId);
        } catch (RuntimeException e) {
            // Fail CLOSED — a broken quota query must not become a free-seat
            // exploit. The previous aspect swallowed this and continued; the
            // audit found workspaces at 30x their paid cap for that reason.
            log.error("SEAT_QUOTA_LOOKUP_FAILED tenant={} additional={}: {}",
                    tenantId, additional, e.toString(), e);
            throw new SeatLimitExceededException(tenantId,
                    SeatLimitExceededException.CODE_QUOTA_LOOKUP_FAILED,
                    "Could not verify seat availability right now. Please retry; "
                            + "contact support if this keeps happening.");
        }

        if (u.purchased() <= 0) {
            // A configured-but-zero cap is a real cap ("this workspace has
            // bought nothing"): block it. Callers that want to fail-open on
            // missing config should not be assigning 0 as a cap.
            log.info("SEAT_LIMIT_EXCEEDED tenant={} purchased=0 current={} (no active plan)",
                    tenantId, u.current());
            throw new SeatLimitExceededException(tenantId, 0, u.current());
        }

        if (u.current() + additional > u.purchased()) {
            log.info("SEAT_LIMIT_EXCEEDED tenant={} purchased={} current={} additional={}",
                    tenantId, u.purchased(), u.current(), additional);
            throw new SeatLimitExceededException(
                    tenantId, u.purchased(), u.current());
        }
    }
}
