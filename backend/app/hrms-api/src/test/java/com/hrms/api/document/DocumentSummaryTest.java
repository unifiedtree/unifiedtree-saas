package com.hrms.api.document;

import com.hrms.api.hiring.FakeJdbc;
import com.unifiedtree.security.tenant.TenantContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.security.oauth2.jwt.Jwt;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;

/**
 * BW-77: document counts come from the database over every document (not the
 * page on screen), always within the caller's workspace; "waiting for review"
 * only for reviewers; this week starts on Monday, India time.
 */
class DocumentSummaryTest {

    private final UUID tenant = UUID.randomUUID();

    @BeforeEach void tenant() { TenantContext.setTenantId(tenant); }
    @AfterEach void clear() { TenantContext.clear(); }

    private static Jwt jwt(UUID employeeId, String... permissions) {
        Jwt.Builder b = Jwt.withTokenValue("t").header("alg", "none").subject(UUID.randomUUID().toString())
                .claim("permissions", List.of(permissions));
        if (employeeId != null) b.claim("employee_id", employeeId.toString());
        return b.build();
    }

    private static Map<String, Object> counts(long onFile, long soon, long expired, long waiting, long rejected) {
        Map<String, Object> m = new HashMap<>();
        m.put("on_file", onFile); m.put("soon", soon); m.put("expired", expired); m.put("waiting", waiting); m.put("rejected", rejected);
        return m;
    }

    @Test void theWorkspaceSummaryCountsEveryDocumentInThisWorkspace() {
        FakeJdbc db = new FakeJdbc()
                .on("count(*) AS on_file", List.of(counts(1842, 6, 3, 9, 2)))
                .on("count(DISTINCT employee_id)", 249L)
                .on("expiry_date >= ? AND expiry_date <= ?", List.of("Passport"))
                .on("expiry_date < ?", List.of("Driving licence"));
        var s = new DocumentSummaryController(db.jdbc).workspace(jwt(null, "hrms.document.read", "hrms.document.verify"));
        assertEquals(1842, s.onFile());
        assertEquals(6, s.expiringSoon());
        assertEquals(3, s.expired());
        assertEquals(249L, s.people());
        assertEquals(9L, s.waitingForReview());
        assertEquals(List.of("Passport"), s.expiringTitles());
        assertEquals(List.of("Driving licence"), s.expiredTitles());
        for (FakeJdbc.Call c : db.calls) {
            assertTrue(c.sql().contains("tenant_id = ?"), c.sql());
            assertTrue(c.args().contains(tenant), c.sql());
        }
    }

    @Test void waitingForReviewIsOnlyForReviewers() {
        FakeJdbc db = new FakeJdbc().on("count(*) AS on_file", List.of(counts(5, 0, 0, 2, 0))).on("count(DISTINCT employee_id)", 3L);
        assertNull(new DocumentSummaryController(db.jdbc).workspace(jwt(null, "hrms.document.read")).waitingForReview());
    }

    @Test void mySummaryIsMyOwnDocumentsOnly() {
        UUID me = UUID.randomUUID();
        FakeJdbc db = new FakeJdbc().on("count(*) AS on_file", List.of(counts(6, 0, 1, 1, 0))).on("expiry_date < ?", List.of("Driving licence"));
        var s = new DocumentSummaryController(db.jdbc).mine(jwt(me, "hrms.document.read.self"));
        assertEquals(6, s.onFile());
        assertEquals(List.of("Driving licence"), s.expiredTitles());
        assertNull(s.people());
        for (FakeJdbc.Call c : db.calls) {
            assertTrue(c.sql().contains("AND employee_id = ?"), c.sql());
            assertTrue(c.args().contains(me));
        }
        assertEquals(0, new DocumentSummaryController(new FakeJdbc().jdbc).mine(jwt(null, "hrms.document.read.self")).onFile());
    }

    @Test void rejectedDocumentsDoNotCountAsExpiringOrExpired() {
        FakeJdbc db = new FakeJdbc().on("count(*) AS on_file", List.of(counts(1, 0, 0, 0, 1)));
        new DocumentSummaryController(db.jdbc).employee(UUID.randomUUID());
        String sql = db.callsContaining("count(*) AS on_file").get(0).sql();
        assertEquals(2, sql.split("<> 'REJECTED'").length - 1);
    }

    @Test void theReviewWeekStartsOnMondayIndiaTime() {
        ZoneId ist = ZoneId.of("Asia/Kolkata");
        // Sunday 4 Oct 2026, 23:00 India time → Monday 28 Sep 00:00 India time
        Instant start = DocumentSummaryController.weekStart(ZonedDateTime.of(2026, 10, 4, 23, 0, 0, 0, ist)).toInstant();
        assertEquals(LocalDate.of(2026, 9, 28).atStartOfDay(ist).toInstant(), start);
        // Monday 5 Oct, 00:10 India time is still Sunday in UTC, but it's a new week here
        Instant monday = DocumentSummaryController.weekStart(ZonedDateTime.of(2026, 10, 5, 0, 10, 0, 0, ist)).toInstant();
        assertEquals(LocalDate.of(2026, 10, 5).atStartOfDay(ist).toInstant(), monday);
    }
}
