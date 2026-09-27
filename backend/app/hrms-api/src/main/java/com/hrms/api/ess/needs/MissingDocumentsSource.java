package com.hrms.api.ess.needs;

import com.hrms.api.ess.EssCaller;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.util.List;

/**
 * Required document types I haven't uploaded: exactly the list
 * {@code GET /v1/document/my/missing} answers (active, required types with no
 * upload of mine that is waiting or verified), less the types HR rejected an
 * upload of, which show as "upload again" instead. Needs that endpoint's
 * {@code hrms.document.type.read} and the My documents page's
 * {@code hrms.document.read.self}; hrms module. Shown as one row, so a new
 * joiner's checklist doesn't crowd out everything else.
 */
@Component
class MissingDocumentsSource implements NeedsYouSource {

    private final JdbcTemplate jdbc;

    MissingDocumentsSource(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Override public String key() { return "DOCUMENT_MISSING"; }
    @Override public String module() { return "hrms"; }

    @Override
    public boolean allowed(EssCaller caller) {
        return caller.has("hrms.document.type.read") && caller.has("hrms.document.read.self");
    }

    @Override
    public List<NeedsYouItem> load(EssCaller caller) {
        List<String> names = jdbc.queryForList("""
                SELECT t.display_name
                  FROM document_mgmt.document_types t
                 WHERE t.tenant_id = ? AND t.active = TRUE AND t.required = TRUE
                   AND NOT EXISTS (
                     SELECT 1 FROM document_mgmt.employee_documents d
                      WHERE d.tenant_id = t.tenant_id AND d.employee_id = ?
                        AND d.document_type_id = t.id
                        AND d.verification_status IN ('PENDING','VERIFIED'))
                   AND NOT EXISTS (
                     SELECT 1 FROM document_mgmt.employee_documents r
                      WHERE r.tenant_id = t.tenant_id AND r.employee_id = ?
                        AND r.document_type_id = t.id AND r.verification_status = 'REJECTED')
                 ORDER BY t.sort_order, t.display_name
                """, String.class, caller.tenantId(), caller.employeeId(), caller.employeeId());
        if (names.isEmpty()) return List.of();
        String title = names.size() == 1 ? "Upload your " + names.get(0) : "Upload " + names.size() + " documents";
        return List.of(new NeedsYouItem("DOCUMENT_MISSING", title, names.size() == 1 ? "HR needs it on file" : list(names),
                null, null, NeedsYouItem.GOLD, null, names.size(), "/hrms/documents?view=my"));
    }

    /** "PAN card, Aadhaar card and Passport". */
    static String list(List<String> names) {
        if (names.size() == 1) return names.get(0);
        return String.join(", ", names.subList(0, names.size() - 1)) + " and " + names.get(names.size() - 1);
    }
}
