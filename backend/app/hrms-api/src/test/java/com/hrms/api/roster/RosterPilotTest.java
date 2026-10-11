package com.hrms.api.roster;

import com.hrms.core.exception.HrmsException;
import com.unifiedtree.security.tenant.TenantContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Shift planning's pilot list (owner, 11 Oct 2026): business subdomains, comma-separated, spaces and case ignored;
 * a business on it is switched on, every other one (nclever included) is refused with 403 FEATURE_NOT_ENABLED.
 */
class RosterPilotTest {

    private final UUID tenant = UUID.randomUUID();

    @BeforeEach void tenant() { TenantContext.setTenantId(tenant); }
    @AfterEach void clear() { TenantContext.clear(); }

    /** The pilot with {@code list} configured, where the database says this business's subdomain is {@code subdomain}. */
    private static RosterPilot pilot(String list, String subdomain) {
        return new RosterPilot(null, list) {
            @Override String subdomain(UUID tenantId) { return subdomain; }
        };
    }

    @Test
    void theListIsSubdomainsSeparatedByCommasWithSpacesAndCaseIgnored() {
        assertEquals(List.of("demo-hrms", "demotech", "srcai"), List.copyOf(RosterPilot.parse(" Demo-HRMS , demotech,,SRCAI ,")));
        assertEquals(List.of("sri"), List.copyOf(RosterPilot.parse("sri, SRI ,Sri")));
        assertTrue(RosterPilot.parse("").isEmpty());
        assertTrue(RosterPilot.parse(" , ").isEmpty());
        assertTrue(RosterPilot.parse(null).isEmpty());
    }

    @Test
    void byDefaultOnlyTheTestBusinessesAreOn() {
        assertEquals(List.of("demo-hrms", "demotech", "srcai", "srcai2026", "sri", "ionora", "unity"),
                List.copyOf(RosterPilot.parse(RosterPilot.DEFAULT_TENANTS)));
        assertEquals(List.copyOf(RosterPilot.parse(RosterPilot.DEFAULT_TENANTS)),
                List.copyOf(pilot(RosterPilot.DEFAULT_TENANTS, "sri").subdomains()));
        for (String test : RosterPilot.DEFAULT_TENANTS.split(",")) assertTrue(pilot(RosterPilot.DEFAULT_TENANTS, test).enabled(), test);
        assertFalse(pilot(RosterPilot.DEFAULT_TENANTS, "nclever").enabled(), "real customers only after the owner's OK");
        assertFalse(pilot(RosterPilot.DEFAULT_TENANTS, "demo").enabled());
    }

    @Test
    void aBusinessOnTheListIsOnWhateverTheCaseOfItsSubdomain() {
        assertTrue(pilot("demo-hrms, Sri", "demo-hrms").enabled());
        assertTrue(pilot("demo-hrms, Sri", "SRI").enabled());
        assertTrue(pilot(" SRI ", " sri ").enabled(tenant));
        assertDoesNotThrow(() -> pilot("sri", "sri").require());
    }

    @Test
    void anyOtherBusinessIsRefusedWithFeatureNotEnabled() {
        RosterPilot pilot = pilot("demo-hrms,sri", "nclever");
        assertFalse(pilot.enabled());
        HrmsException e = assertThrows(HrmsException.class, pilot::require);
        assertEquals(403, e.getStatus().value());
        assertEquals("FEATURE_NOT_ENABLED", e.getErrorCode());
        assertEquals("Shift planning isn't switched on for this business yet.", e.getMessage());
        // the whole subdomain must match: a longer or shorter name is another business
        assertFalse(pilot("sri", "sri2").enabled());
        assertFalse(pilot("srcai2026", "srcai").enabled());
    }

    @Test
    void noBusinessAnEmptyListOrNoTenantIsOff() {
        assertFalse(pilot("sri", null).enabled(), "no such business");
        assertFalse(pilot("", "sri").enabled(), "an empty list switches it off for everyone");
        assertFalse(pilot("sri", "sri").enabled(null));
        TenantContext.clear();
        assertFalse(pilot("sri", "sri").enabled(), "a request outside any business");
        assertThrows(HrmsException.class, () -> pilot("sri", "sri").require());
    }

    @Test
    void anEmptyListNeverAsksTheDatabase() {
        RosterPilot pilot = new RosterPilot(null, " ");   // no JdbcTemplate: asking it would fail
        assertFalse(pilot.enabled(tenant));
        assertThrows(HrmsException.class, pilot::require);
    }
}
