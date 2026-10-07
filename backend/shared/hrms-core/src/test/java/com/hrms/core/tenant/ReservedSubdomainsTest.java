package com.hrms.core.tenant;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/** UnifiedTree's own addresses, which no business may take or answer for. */
class ReservedSubdomainsTest {

    @Test
    void theSystemHostsAreReserved() {
        for (String host : new String[]{"www", "api", "admin", "app", "mail", "marketing", "business", "unifiedtree"}) {
            assertThat(ReservedSubdomains.isReserved(host)).as(host).isTrue();
        }
    }

    @Test
    void caseAndSurroundingSpacesDoNotMatter() {
        assertThat(ReservedSubdomains.isReserved(" Admin ")).isTrue();
        assertThat(ReservedSubdomains.isReserved("MARKETING")).isTrue();
    }

    @Test
    void ordinaryBusinessNamesAreNotReserved() {
        assertThat(ReservedSubdomains.isReserved("tatagroups")).isFalse();
        assertThat(ReservedSubdomains.isReserved("tata")).isFalse();
        assertThat(ReservedSubdomains.isReserved("admin-team")).isFalse();
        assertThat(ReservedSubdomains.isReserved("")).isFalse();
        assertThat(ReservedSubdomains.isReserved(null)).isFalse();
    }

    @Test
    void theListIsLowerCase() {
        assertThat(ReservedSubdomains.all()).allSatisfy(n -> assertThat(n).isEqualTo(n.toLowerCase()));
    }
}
