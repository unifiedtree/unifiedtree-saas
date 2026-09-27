package com.hrms.api.hiring;

import com.hrms.hiring.service.OfferEmailBook;
import com.unifiedtree.security.tenant.TenantContext;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowCallbackHandler;
import org.springframework.stereotype.Repository;

import java.util.Collection;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * hiring_mgmt.offer_candidate_emails (V143.59) with JDBC, in the caller's
 * transaction. The table is looked up before each use, so a database without
 * the migration keeps working as before (no email stored, none returned)
 * instead of aborting the caller's transaction.
 */
@Repository
public class JdbcOfferEmailBook implements OfferEmailBook {

    static final String TABLE = "hiring_mgmt.offer_candidate_emails";

    private final JdbcTemplate jdbc;

    @PersistenceContext
    private EntityManager entityManager;

    public JdbcOfferEmailBook(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    JdbcOfferEmailBook(JdbcTemplate jdbc, EntityManager entityManager) {
        this.jdbc = jdbc;
        this.entityManager = entityManager;
    }

    @Override
    public boolean save(UUID offerId, String email) {
        if (offerId == null || !JdbcCandidateStageLog.tablePresent(jdbc, TABLE)) return false;
        UUID tenant = TenantContext.requireTenantId();
        if (email == null || email.isBlank()) {
            jdbc.update("DELETE FROM hiring_mgmt.offer_candidate_emails WHERE tenant_id = ? AND offer_id = ?", tenant, offerId);
            return true;
        }
        // A new offer is still only in the JPA session; write it first for the foreign key.
        if (entityManager != null) entityManager.flush();
        jdbc.update("""
                INSERT INTO hiring_mgmt.offer_candidate_emails (tenant_id, offer_id, email, updated_at, updated_by)
                VALUES (?, ?, ?, now(), ?)
                ON CONFLICT (tenant_id, offer_id) DO UPDATE
                   SET email = EXCLUDED.email, updated_at = now(), updated_by = EXCLUDED.updated_by
                """, tenant, offerId, email.trim(), TenantContext.getUserId());
        return true;
    }

    @Override
    public Map<UUID, String> find(Collection<UUID> offerIds) {
        Map<UUID, String> out = new HashMap<>();
        if (offerIds == null || offerIds.isEmpty() || !JdbcCandidateStageLog.tablePresent(jdbc, TABLE)) return out;
        List<UUID> ids = List.copyOf(offerIds);
        String in = String.join(",", Collections.nCopies(ids.size(), "?"));
        Object[] args = new Object[ids.size() + 1];
        args[0] = TenantContext.requireTenantId();
        for (int i = 0; i < ids.size(); i++) args[i + 1] = ids.get(i);
        jdbc.query("SELECT offer_id, email FROM hiring_mgmt.offer_candidate_emails WHERE tenant_id = ? AND offer_id IN (" + in + ")",
                (RowCallbackHandler) rs -> out.put(rs.getObject("offer_id", UUID.class), rs.getString("email")), args);
        return out;
    }
}
