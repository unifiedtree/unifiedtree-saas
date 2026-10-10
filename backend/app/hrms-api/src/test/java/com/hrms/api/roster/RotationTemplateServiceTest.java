package com.hrms.api.roster;

import com.hrms.api.roster.RosterContract.PatternDay;
import com.hrms.api.roster.RosterContract.RotationTemplate;
import com.hrms.api.roster.RosterContract.TemplateBody;
import com.hrms.core.exception.HrmsException;
import com.unifiedtree.security.tenant.TenantContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.oauth2.jwt.Jwt;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Rotation patterns (design §1.1 tables 1–2, endpoints 1–4): 1 to 62 days, each exactly one active
 * shift of the company or WO; a name, unique in the company; a department head makes and changes only
 * their own departments' patterns and sees the company-wide ones read-only.
 */
class RotationTemplateServiceTest {

    static final UUID TENANT = UUID.randomUUID(), COMPANY = UUID.randomUUID(), SALES = UUID.randomUUID(), SUPPORT = UUID.randomUUID();

    final RosterFakes.Shifts shifts = new RosterFakes.Shifts();
    ShiftCatalog.Shift a, b, old, otherCompany;
    final Map<UUID, RotationTemplateService.Head> heads = new java.util.LinkedHashMap<>();
    final List<String> writes = new ArrayList<>();
    boolean nameTaken;

    /** Records writes; the unique name index answers DuplicateKeyException when {@link #nameTaken}. */
    final JdbcTemplate jdbc = new JdbcTemplate() {
        @Override public int update(String sql, Object... args) {
            if (nameTaken && sql.contains("rotation_templates") && (sql.contains("INSERT") || sql.contains("SET name"))) {
                throw new DuplicateKeyException("uq_rotation_templates_name");
            }
            writes.add(sql.trim().split("\\s+")[0] + " " + args.length);
            if (sql.contains("INSERT INTO attendance.rotation_templates")) {
                UUID id = (UUID) args[0];
                heads.put(id, new RotationTemplateService.Head(id, (UUID) args[2], (UUID) args[3], (String) args[4], (Boolean) args[5],
                        (String) args[10], Instant.now()));
            }
            return 1;
        }
    };
    final Map<UUID, List<PatternDay>> savedDays = new HashMap<>();

    final PlannerScope scope = new PlannerScope() {
        @Override public Actor actor(Jwt jwt, UUID companyId) {
            boolean wide = RosterAuth.has(jwt, RosterAuth.WORKFORCE_ADMIN);
            return new Actor(RosterAuth.userId(jwt), RosterAuth.employeeId(jwt), "Planner", COMPANY, wide,
                    wide ? Set.of() : Set.of(SALES), RosterAuth.has(jwt, RosterAuth.PUBLISH));
        }
        @Override public void check(Actor a, UUID departmentId, Collection<UUID> employeeIds) {}
    };

    RotationTemplateService service;
    final Jwt hr = RosterFakes.jwt(UUID.randomUUID(), UUID.randomUUID(), RosterAuth.PLAN, RosterAuth.PUBLISH, RosterAuth.WORKFORCE_ADMIN);
    final Jwt head = RosterFakes.jwt(UUID.randomUUID(), UUID.randomUUID(), RosterAuth.PLAN);

    @BeforeEach
    void setUp() {
        TenantContext.setTenantId(TENANT);
        a = shifts.add(COMPANY, "A", "Morning", "06:00", "14:00", "FIXED", true);
        b = shifts.add(COMPANY, "B", "Evening", "14:00", "22:00", "FIXED", true);
        old = shifts.add(COMPANY, "O", "Old", "09:00", "17:00", "FIXED", false);
        otherCompany = shifts.add(UUID.randomUUID(), "Z", "Elsewhere", "09:00", "17:00", "FIXED", true);
        service = new RotationTemplateService(jdbc, new RosterFakes.Tables(), scope, shifts) {
            @Override boolean departmentKnown(UUID tenant, UUID companyId, UUID departmentId) {
                return SALES.equals(departmentId) || SUPPORT.equals(departmentId);
            }
            @Override List<Head> heads(UUID tenant, UUID companyId) {
                return new ArrayList<>(heads.values());
            }
            @Override Head head(UUID tenant, UUID id) {
                Head h = heads.get(id);
                if (h == null) throw new com.hrms.core.exception.ResourceNotFoundException("That pattern wasn't found.");
                return h;
            }
            @Override void insertDays(UUID tenant, UUID templateId, List<PatternDay> days) {
                savedDays.put(templateId, days);
            }
            @Override Map<UUID, List<PatternDay>> days(UUID tenant, List<UUID> ids) {
                Map<UUID, List<PatternDay>> out = new HashMap<>();
                for (UUID id : ids) out.put(id, List.of(new PatternDay(a.id(), false), new PatternDay(null, true)));
                return out;
            }
        };
    }

    @AfterEach
    void tearDown() {
        TenantContext.clear();
    }

    static PatternDay shift(ShiftCatalog.Shift s) { return new PatternDay(s.id(), false); }
    static final PatternDay WO = new PatternDay(null, true);

    Actor hrActor() { return scope.actor(hr, COMPANY); }
    Actor headActor() { return scope.actor(head, COMPANY); }

    @Test
    void aPatternIsOneTo62DaysEachOneShiftOrWo() {
        RotationTemplateService.Valid v = service.validate(TENANT, hrActor(),
                new TemplateBody("  2 + 2 +  2 + 1 ", null, true, List.of(shift(a), shift(a), shift(b), shift(b), WO)));
        assertEquals("2 + 2 + 2 + 1", v.name(), "spaces are tidied");
        assertEquals(5, v.days().size());
        assertNull(v.departmentId(), "company-wide");

        assertCode("TEMPLATE_INVALID", () -> service.validate(TENANT, hrActor(), new TemplateBody("Empty", null, true, List.of())));
        assertCode("TEMPLATE_INVALID", () -> service.validate(TENANT, hrActor(), new TemplateBody("Long", null, true,
                Collections.nCopies(63, shift(a)))));
        assertDoesNotThrow(() -> service.validate(TENANT, hrActor(), new TemplateBody("Max", null, true, Collections.nCopies(62, shift(a)))));
        assertCode("TEMPLATE_INVALID", () -> service.validate(TENANT, hrActor(), new TemplateBody("Both", null, true,
                List.of(new PatternDay(a.id(), true)))), "a day can't be a shift and WO");
        assertCode("TEMPLATE_INVALID", () -> service.validate(TENANT, hrActor(), new TemplateBody("Neither", null, true,
                List.of(new PatternDay(null, false)))));
        assertCode("TEMPLATE_INVALID", () -> service.validate(TENANT, hrActor(), new TemplateBody("Old", null, true, List.of(shift(old)))),
                "a switched-off shift");
        assertCode("TEMPLATE_INVALID", () -> service.validate(TENANT, hrActor(), new TemplateBody("Other", null, true, List.of(shift(otherCompany)))),
                "another company's shift");
        assertCode("TEMPLATE_INVALID", () -> service.validate(TENANT, hrActor(), new TemplateBody(" ", null, true, List.of(WO))));
        assertCode("TEMPLATE_INVALID", () -> service.validate(TENANT, hrActor(), new TemplateBody("x".repeat(81), null, true, List.of(WO))));
        assertCode("TEMPLATE_INVALID", () -> service.validate(TENANT, hrActor(), new TemplateBody("Dept", UUID.randomUUID(), true, List.of(WO))),
                "a department of another company");
    }

    @Test
    void aTakenNameIs409() {
        nameTaken = true;
        HrmsException ex = assertThrows(HrmsException.class,
                () -> service.create(hr, COMPANY, new TemplateBody("AABBCCWO", null, true, List.of(shift(a), WO))));
        assertEquals("TEMPLATE_NAME_TAKEN", ex.getErrorCode());
        assertEquals(409, ex.getStatus().value());
    }

    @Test
    void creatingWritesTheHeaderAndTheDaysInOrder() {
        RotationTemplate t = service.create(hr, COMPANY, new TemplateBody("AABBCCWO", null, true, List.of(shift(a), shift(a), shift(b), WO)));
        assertEquals("AABBCCWO", t.name());
        assertNull(t.departmentId());
        assertTrue(t.editable());
        assertEquals("INSERT 11", writes.get(0), "the header, with who made it");
        assertEquals(List.of(shift(a), shift(a), shift(b), WO), savedDays.get(t.id()));
    }

    @Test
    void aDepartmentHeadMakesPatternsOnlyForTheirDepartment() {
        RotationTemplateService.Valid own = service.validate(TENANT, headActor(), new TemplateBody("Sales week", SALES, true, List.of(shift(a), WO)));
        assertEquals(SALES, own.departmentId());
        assertCode("TEMPLATE_INVALID", () -> service.validate(TENANT, headActor(), new TemplateBody("Company", null, true, List.of(WO))),
                "a department head's pattern needs their department");
        assertCode("ROSTER_SCOPE", () -> service.validate(TENANT, headActor(), new TemplateBody("Support", SUPPORT, true, List.of(WO))));
    }

    @Test
    void aDepartmentHeadSeesCompanyPatternsReadOnlyAndChangesOnlyTheirOwn() {
        UUID company = put(null, "Company AABB"), sales = put(SALES, "Sales"), support = put(SUPPORT, "Support");
        List<RotationTemplate> seen = service.list(head, COMPANY);
        assertEquals(List.of(company, sales), seen.stream().map(RotationTemplate::id).toList(), "another department's pattern is hidden");
        assertFalse(seen.get(0).editable(), "company-wide: read-only for a department head");
        assertTrue(seen.get(1).editable());
        assertEquals(2, seen.get(1).days().size());

        HrmsException ex = assertThrows(HrmsException.class, () -> service.delete(head, company));
        assertEquals("ROSTER_SCOPE", ex.getErrorCode());
        assertEquals("Only HR can change company-wide patterns.", ex.getMessage());
        assertCode("ROSTER_SCOPE", () -> service.replace(head, support, new TemplateBody("Support", SUPPORT, true, List.of(WO))));
        assertDoesNotThrow(() -> service.delete(head, sales));

        List<RotationTemplate> all = service.list(hr, COMPANY);
        assertEquals(3, all.size(), "HR sees every pattern");
        assertTrue(all.stream().allMatch(RotationTemplate::editable));
        assertDoesNotThrow(() -> service.delete(hr, company));
    }

    private UUID put(UUID dept, String name) {
        UUID id = UUID.randomUUID();
        heads.put(id, new RotationTemplateService.Head(id, COMPANY, dept, name, true, "HR", Instant.now()));
        return id;
    }

    private static void assertCode(String code, org.junit.jupiter.api.function.Executable run) {
        assertCode(code, run, code);
    }

    private static void assertCode(String code, org.junit.jupiter.api.function.Executable run, String why) {
        HrmsException ex = assertThrows(HrmsException.class, run, why);
        assertEquals(code, ex.getErrorCode(), why);
    }
}
