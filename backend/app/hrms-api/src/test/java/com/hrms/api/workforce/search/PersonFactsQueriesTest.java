package com.hrms.api.workforce.search;

import com.hrms.api.workforce.SearchController;
import com.hrms.employee.workforce.service.WorkforceEmployeeService;
import com.unifiedtree.security.tenant.TenantContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.web.server.ResponseStatusException;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.stream.IntStream;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;

/** BW-02: the ⌘K preview's person facts — same visibility as people search, the caller's tenant only, at most 20. */
class PersonFactsQueriesTest {

    @AfterEach void clear() { TenantContext.clear(); }

    @Test
    void theQueryIsTheDirectorysVisibilityInTheCallersTenant() {
        String sql = PersonFactsQueries.sql(2);
        assertThat(sql).contains("WHERE e.tenant_id = ? AND e.is_active = TRUE");
        assertThat(sql).contains("b.tenant_id = e.tenant_id");   // the branch from the same tenant
        assertThat(sql).contains("m.tenant_id = e.tenant_id");   // the manager from the same tenant
        assertThat(sql).contains("e.id IN (?, ?)");
        // Directory-level facts only: nothing private (pay, bank, ids, contact).
        for (String hidden : List.of("ctc", "bank", "pan_number", "aadhaar", "phone", "date_of_birth", "address")) assertThat(sql).doesNotContain(hidden);
    }

    @Test
    @SuppressWarnings("unchecked")
    void itBindsTheTenantFirstThenAtMostTwentyDistinctIds() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        UUID tenant = UUID.randomUUID();
        List<UUID> ids = new ArrayList<>(IntStream.range(0, 25).mapToObj(i -> UUID.randomUUID()).toList());
        ids.add(ids.get(0));
        ids.add(null);
        new PersonFactsQueries(jdbc).facts(tenant, ids);
        ArgumentCaptor<Object[]> args = ArgumentCaptor.forClass(Object[].class);
        verify(jdbc).query(anyString(), any(RowMapper.class), args.capture());
        Object[] bound = args.getValue();
        assertThat(bound[0]).isEqualTo(tenant);
        assertThat(bound).hasSize(1 + PersonFactsQueries.MAX_IDS);
        assertThat(List.of(bound).subList(1, bound.length)).doesNotHaveDuplicates().doesNotContainNull();
    }

    @Test
    void noTenantOrNoIdsNoQuery() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        PersonFactsQueries q = new PersonFactsQueries(jdbc);
        assertThat(q.facts(null, List.of(UUID.randomUUID()))).isEmpty();
        assertThat(q.facts(UUID.randomUUID(), List.of())).isEmpty();
        verifyNoInteractions(jdbc);
    }

    @Test
    void theEndpointRefusesMoreThanTwentyAndAsksInTheCallersTenant() {
        PersonFactsQueries facts = mock(PersonFactsQueries.class);
        SearchController c = new SearchController(mock(WorkforceEmployeeService.class), facts);
        List<UUID> many = IntStream.range(0, 21).mapToObj(i -> UUID.randomUUID()).toList();
        assertThatThrownBy(() -> c.facts(many)).isInstanceOf(ResponseStatusException.class);
        UUID tenant = UUID.randomUUID();
        TenantContext.setTenantId(tenant);
        List<UUID> few = List.of(UUID.randomUUID());
        c.facts(few);
        verify(facts).facts(tenant, few);
    }
}
