package com.hrms.api.letters;

import com.hrms.core.dto.PageResponse;
import com.hrms.letters.dto.GeneratedLetterDto;
import com.unifiedtree.security.tenant.TenantContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowCallbackHandler;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;

/**
 * The extra fields on generated letters (redesign BW-71): the employee's
 * department, the template's name, who generated the letter, and the signature
 * request (BW-76). Read in one query per page over existing tables, plus the
 * signature table when it exists. A failure leaves the fields empty; the list
 * itself never fails because of them. No transaction of its own: each read
 * stands alone, so one failing never aborts the others.
 */
@Component
public class LetterExtras {

    private static final Logger log = LoggerFactory.getLogger(LetterExtras.class);

    private final JdbcTemplate jdbc;
    private final LetterSigningService signing;

    public LetterExtras(JdbcTemplate jdbc, LetterSigningService signing) {
        this.jdbc = jdbc;
        this.signing = signing;
    }

    record Names(String department, String template, String generatedBy) {}

    public PageResponse<GeneratedLetterDto> page(PageResponse<GeneratedLetterDto> page) {
        return new PageResponse<>(list(page.content()), page.page(), page.size(), page.totalElements(), page.totalPages(), page.last());
    }

    public GeneratedLetterDto one(GeneratedLetterDto letter) {
        return list(List.of(letter)).get(0);
    }

    public List<GeneratedLetterDto> list(List<GeneratedLetterDto> letters) {
        if (letters.isEmpty()) return letters;
        List<UUID> ids = letters.stream().map(GeneratedLetterDto::id).filter(Objects::nonNull).distinct().toList();
        Map<UUID, Names> names = names(ids);
        boolean ready = signing.ready();
        Map<UUID, LetterSigningService.Signature> sigs = ready ? signing.of(ids) : Map.of();
        List<GeneratedLetterDto> out = new ArrayList<>(letters.size());
        for (GeneratedLetterDto l : letters) {
            Names n = names.getOrDefault(l.id(), new Names(null, null, null));
            LetterSigningService.Signature s = sigs.get(l.id());
            out.add(l.withExtras(n.department(), n.template(), n.generatedBy(),
                    ready ? s != null : null, s == null ? null : s.requestedAt(), s == null ? null : s.signedName()));
        }
        return out;
    }

    private Map<UUID, Names> names(List<UUID> ids) {
        Map<UUID, Names> out = new HashMap<>();
        if (ids.isEmpty()) return out;
        try {
            List<Object> args = new ArrayList<>();
            args.add(TenantContext.requireTenantId());
            args.addAll(ids);
            jdbc.query("""
                    SELECT g.id, d.name AS department, t.name AS template,
                           coalesce(nullif(trim(concat_ws(' ', ge.first_name, ge.last_name)), ''),
                                    nullif(trim(uc.display_name), ''), uc.email) AS generated_by
                      FROM letters.generated g
                      LEFT JOIN hrms.employees e ON e.id = g.employee_id AND e.tenant_id = g.tenant_id
                      LEFT JOIN hrms.departments d ON d.id = e.department_id AND d.tenant_id = g.tenant_id
                      LEFT JOIN letters.templates t ON t.id = g.template_id AND t.tenant_id = g.tenant_id
                      LEFT JOIN auth.user_credentials uc ON uc.id = g.generated_by AND uc.tenant_id = g.tenant_id
                      LEFT JOIN hrms.employees ge ON ge.id = uc.employee_id AND ge.tenant_id = g.tenant_id
                     WHERE g.tenant_id = ? AND g.id IN (""" + String.join(",", Collections.nCopies(ids.size(), "?")) + ")",
                    (RowCallbackHandler) rs -> out.put(rs.getObject("id", UUID.class),
                            new Names(rs.getString("department"), rs.getString("template"), rs.getString("generated_by"))),
                    args.toArray());
        } catch (RuntimeException e) {
            log.warn("Letter names unavailable: {}", e.getMessage());
        }
        return out;
    }
}
