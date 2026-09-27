package com.hrms.employee.workforce.service;

import com.hrms.employee.quota.SeatQuotaEnforcer;
import com.hrms.employee.workforce.dto.WorkforceDtos.WorkforceFilter;
import com.hrms.employee.workforce.entity.Branch;
import com.hrms.employee.workforce.entity.Department;
import com.hrms.employee.workforce.entity.Designation;
import com.hrms.employee.workforce.entity.WorkforceEmployee;
import com.hrms.employee.workforce.repository.WorkforceDepartmentRepository;
import com.hrms.employee.workforce.repository.WorkforceEmployeeRepository;
import jakarta.persistence.criteria.CriteriaBuilder;
import jakarta.persistence.criteria.CriteriaQuery;
import jakarta.persistence.criteria.Root;
import jakarta.persistence.criteria.Subquery;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.jdbc.core.JdbcTemplate;

import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyChar;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.RETURNS_MOCKS;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** BW-96: the directory's word-by-word search and the direct-reports filter. */
class DirectoryWordSearchTest {

    private WorkforceEmployeeRepository repository;
    private WorkforceEmployeeService service;

    @BeforeEach
    void setUp() {
        repository = mock(WorkforceEmployeeRepository.class);
        service = new WorkforceEmployeeService(repository, mock(WorkforceDepartmentRepository.class),
                mock(JdbcTemplate.class), mock(SeatQuotaEnforcer.class));
        Page<WorkforceEmployee> empty = new PageImpl<>(List.of());
        when(repository.findAll(any(Specification.class), any(Pageable.class))).thenReturn(empty);
    }

    @Test
    void wordsAreTheQuerysDistinctLowerCaseWordsUpToFour() {
        assertThat(WorkforceEmployeeService.directoryWords("  Sales   PRIYA ")).containsExactly("sales", "priya");
        assertThat(WorkforceEmployeeService.directoryWords("a b a c d e")).containsExactly("a", "b", "c", "d");
        assertThat(WorkforceEmployeeService.directoryWords("   ")).isEmpty();
        assertThat(WorkforceEmployeeService.directoryWords(null)).isEmpty();
    }

    @SuppressWarnings("unchecked")
    private Specification<WorkforceEmployee> specFor(WorkforceFilter f) {
        service.directory(f);
        ArgumentCaptor<Specification<WorkforceEmployee>> spec = ArgumentCaptor.forClass(Specification.class);
        verify(repository).findAll(spec.capture(), any(Pageable.class));
        return spec.getValue();
    }

    @Test
    @SuppressWarnings("unchecked")
    void eachWordAlsoLooksInDepartmentDesignationAndBranchNames() {
        Specification<WorkforceEmployee> spec = specFor(new WorkforceFilter(null, null, null, null, "sales priya", 0, 10));
        Root<WorkforceEmployee> root = mock(Root.class, RETURNS_MOCKS);
        CriteriaQuery<Object> query = mock(CriteriaQuery.class, RETURNS_MOCKS);
        CriteriaBuilder cb = mock(CriteriaBuilder.class, RETURNS_MOCKS);
        Subquery<UUID> sub = mock(Subquery.class, RETURNS_MOCKS);
        when(query.subquery(UUID.class)).thenReturn(sub);
        spec.toPredicate(root, query, cb);
        // three name lookups per word
        verify(query, times(6)).subquery(UUID.class);
        verify(sub, times(2)).from(Department.class);
        verify(sub, times(2)).from(Designation.class);
        verify(sub, times(2)).from(Branch.class);
        // user text is matched literally (LIKE with an escape character) and never concatenated
        verify(cb, atLeastOnce()).like(any(), eq("%sales%"), eq('\\'));
        verify(cb, atLeastOnce()).like(any(), eq("%priya%"), eq('\\'));
        // the whole query still matches as before
        verify(cb, atLeastOnce()).like(any(), eq("%sales priya%"));
    }

    @Test
    @SuppressWarnings("unchecked")
    void likeCharactersInAWordAreEscaped() {
        Specification<WorkforceEmployee> spec = specFor(new WorkforceFilter(null, null, null, null, "50%_off", 0, 10));
        CriteriaQuery<Object> query = mock(CriteriaQuery.class, RETURNS_MOCKS);
        CriteriaBuilder cb = mock(CriteriaBuilder.class, RETURNS_MOCKS);
        spec.toPredicate(mock(Root.class, RETURNS_MOCKS), query, cb);
        verify(cb, atLeastOnce()).like(any(), eq("%50\\%\\_off%"), anyChar());
    }

    @Test
    @SuppressWarnings("unchecked")
    void noSearchNoSubqueriesAndTheDirectReportsFilter() {
        UUID manager = UUID.randomUUID();
        Specification<WorkforceEmployee> spec = specFor(new WorkforceFilter(null, null, null, null, null, 0, 10,
                false, null, null, null, manager));
        Root<WorkforceEmployee> root = mock(Root.class, RETURNS_MOCKS);
        CriteriaQuery<Object> query = mock(CriteriaQuery.class, RETURNS_MOCKS);
        CriteriaBuilder cb = mock(CriteriaBuilder.class, RETURNS_MOCKS);
        spec.toPredicate(root, query, cb);
        verify(query, never()).subquery(any());
        verify(root, atLeastOnce()).get("reportingManagerId");
        verify(cb).equal(any(), eq(manager));
        verify(cb, never()).like(any(), anyString());
    }
}
