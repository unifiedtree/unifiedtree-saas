package com.hrms.api.hiring;

import com.hrms.hiring.enums.CandidateStage;
import com.hrms.hiring.service.CandidateStageLog;
import com.unifiedtree.security.tenant.TenantContext;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;

/**
 * Writes hiring_mgmt.candidate_stage_events (V143.59) with JDBC.
 *
 * <p>{@link Propagation#MANDATORY}: a history row can only be written inside
 * the transaction that moves the candidate (HiringService's), so the move and
 * its row commit or roll back together, and a call outside one fails loudly.
 *
 * <p>While the migration is not applied the write is skipped: the table is
 * looked up first, because a failed statement would abort the caller's
 * transaction (PostgreSQL) and so the stage move itself. Any other database
 * error is NOT swallowed: it rolls the move back, as it should.
 */
@Repository
public class JdbcCandidateStageLog implements CandidateStageLog {

    private static final Logger log = LoggerFactory.getLogger(JdbcCandidateStageLog.class);
    static final String TABLE = "hiring_mgmt.candidate_stage_events";

    private final JdbcTemplate jdbc;

    @PersistenceContext
    private EntityManager entityManager;

    @org.springframework.beans.factory.annotation.Autowired
    public JdbcCandidateStageLog(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /** For tests: the entity manager the pending candidate row is flushed through. */
    JdbcCandidateStageLog(JdbcTemplate jdbc, EntityManager entityManager) {
        this.jdbc = jdbc;
        this.entityManager = entityManager;
    }

    @Override
    @Transactional(propagation = Propagation.MANDATORY)
    public void record(UUID candidateId, CandidateStage from, CandidateStage to, Kind kind) {
        if (candidateId == null || to == null || kind == null) return;
        if (!tablePresent(jdbc, TABLE)) {
            log.debug("Stage history not recorded for candidate {}: {} is not there yet (V143.59)", candidateId, TABLE);
            return;
        }
        // A candidate added in this transaction is still only in the JPA session;
        // write it first so the history row's foreign key finds it.
        if (entityManager != null) entityManager.flush();
        jdbc.update("""
                INSERT INTO hiring_mgmt.candidate_stage_events
                    (tenant_id, candidate_id, from_stage, to_stage, event_kind, changed_at, changed_by)
                VALUES (?, ?, ?, ?, ?, clock_timestamp(), ?)
                """, TenantContext.requireTenantId(), candidateId, from == null ? null : from.name(), to.name(),
                kind.name(), TenantContext.getUserId());
    }

    /** True when {@code table} exists. A lookup that cannot fail, so it is safe inside any transaction. */
    static boolean tablePresent(JdbcTemplate jdbc, String table) {
        Boolean present = jdbc.queryForObject("SELECT to_regclass(?) IS NOT NULL", Boolean.class, table);
        return Boolean.TRUE.equals(present);
    }
}
