package com.hrms.api.ess.needs;

import com.hrms.api.ess.EssCaller;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.UUID;

/**
 * Documents of mine HR rejected, that I haven't uploaded again since
 * ({@code hrms.document.read.self}, the My documents page; hrms module).
 * "Again" means a newer upload of the same document type (or, for an untyped
 * upload, the same category) that is waiting or verified.
 */
@Component
class DocumentsToRedoSource implements NeedsYouSource {

    private final JdbcTemplate jdbc;

    DocumentsToRedoSource(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Override public String key() { return "DOCUMENT_REDO"; }
    @Override public String module() { return "hrms"; }
    @Override public boolean allowed(EssCaller caller) { return caller.has("hrms.document.read.self"); }

    @Override
    public List<NeedsYouItem> load(EssCaller caller) {
        return jdbc.query("""
                SELECT d.id, COALESCE(t.display_name, d.title) AS name, d.rejection_reason
                  FROM document_mgmt.employee_documents d
                  LEFT JOIN document_mgmt.document_types t ON t.id = d.document_type_id AND t.tenant_id = d.tenant_id
                 WHERE d.tenant_id = ? AND d.employee_id = ? AND d.verification_status = 'REJECTED'
                   AND NOT EXISTS (SELECT 1 FROM document_mgmt.employee_documents n
                                    WHERE n.tenant_id = d.tenant_id AND n.employee_id = d.employee_id
                                      AND n.created_at > d.created_at
                                      AND n.verification_status IN ('PENDING', 'VERIFIED')
                                      AND ((d.document_type_id IS NOT NULL AND n.document_type_id = d.document_type_id)
                                        OR (d.document_type_id IS NULL AND n.category = d.category)))
                 ORDER BY d.verified_at DESC NULLS LAST, d.created_at DESC
                """, (rs, i) -> {
                    String name = rs.getString("name");
                    String reason = rs.getString("rejection_reason");
                    return new NeedsYouItem("DOCUMENT_REDO",
                            "Upload your " + (name == null || name.isBlank() ? "document" : name.trim()) + " again",
                            reason == null || reason.isBlank() ? "HR couldn’t accept the last upload" : reason.trim(),
                            null, null, NeedsYouItem.GOLD, rs.getObject("id", UUID.class), 1, "/hrms/documents?view=my");
                }, caller.tenantId(), caller.employeeId());
    }
}
