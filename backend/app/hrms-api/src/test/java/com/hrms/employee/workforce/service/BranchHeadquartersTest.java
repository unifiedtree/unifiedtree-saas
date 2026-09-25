package com.hrms.employee.workforce.service;

import com.hrms.employee.workforce.dto.WorkforceDtos.CreateBranchRequest;
import com.hrms.employee.workforce.dto.WorkforceDtos.UpdateBranchRequest;
import com.hrms.employee.workforce.entity.Branch;
import com.hrms.employee.workforce.repository.WorkforceBranchRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.InOrder;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/** One headquarters per company (P0-9) and the archived-branch listing, without a database. */
class BranchHeadquartersTest {

    private final UUID company = UUID.randomUUID();
    private WorkforceBranchRepository repo;
    private BranchService service;

    @BeforeEach void setUp() {
        repo = mock(WorkforceBranchRepository.class);
        LiveHeadcount headcount = mock(LiveHeadcount.class);
        when(headcount.byColumn("branch_id")).thenReturn(java.util.Map.of());
        when(repo.save(any(Branch.class))).thenAnswer(i -> i.getArgument(0));
        service = new BranchService(repo, headcount);
    }

    private Branch branch(boolean hq, boolean active) {
        Branch b = new Branch();
        b.setId(UUID.randomUUID());
        b.setCompanyId(company);
        b.setName("Pune");
        b.setHeadquarters(hq);
        b.setActive(active);
        when(repo.findById(b.getId())).thenReturn(Optional.of(b));
        return b;
    }

    private static UpdateBranchRequest update(Boolean hq, Boolean active) {
        return new UpdateBranchRequest(null, null, null, null, null, null, null, hq, active);
    }

    @Test void creatingAHeadquartersStepsThePreviousOneDownFirst() {
        service.create(new CreateBranchRequest(company, "Mumbai", "MUM", null, "Mumbai", "Maharashtra", null, null,
                null, null, null, true));
        InOrder order = inOrder(repo);
        order.verify(repo).clearHeadquarters(company);
        ArgumentCaptor<Branch> saved = ArgumentCaptor.forClass(Branch.class);
        order.verify(repo).save(saved.capture());
        assertTrue(saved.getValue().isHeadquarters());
    }

    @Test void creatingAnOrdinaryBranchLeavesTheHeadquartersAlone() {
        service.create(new CreateBranchRequest(company, "Nashik", null, null, "Nashik", "Maharashtra", null, null,
                null, null, null, false));
        verify(repo, never()).clearHeadquarters(any());
        verify(repo, never()).clearHeadquartersExcept(any(), any());
    }

    @Test void markingABranchHeadquartersSwapsInOneSave() {
        Branch b = branch(false, true);
        service.update(b.getId(), update(true, null));
        InOrder order = inOrder(repo);
        order.verify(repo).clearHeadquartersExcept(company, b.getId());
        order.verify(repo).save(b);
        assertTrue(b.isHeadquarters());
    }

    @Test void editingOtherFieldsKeepsTheHeadquartersFlag() {
        Branch hq = branch(true, true);
        service.update(hq.getId(), new UpdateBranchRequest("Pune HQ", null, null, null, null, null, null, null, null));
        assertTrue(hq.isHeadquarters());
        assertEquals("Pune HQ", hq.getName());
        Branch plain = branch(false, true);
        service.update(plain.getId(), new UpdateBranchRequest("Nagpur", null, null, null, null, null, null, null, null));
        assertFalse(plain.isHeadquarters());
        verify(repo, never()).clearHeadquartersExcept(company, plain.getId());
    }

    @Test void anInactiveBranchIsNeverTheHeadquarters() {
        Branch hq = branch(true, true);
        service.update(hq.getId(), update(null, false));
        assertFalse(hq.isHeadquarters());
        assertFalse(hq.isActive());
        Branch other = branch(false, true);
        service.update(other.getId(), update(true, false));
        assertFalse(other.isHeadquarters());
        verify(repo, never()).clearHeadquartersExcept(company, other.getId());
    }

    @Test void archivingTheHeadquartersClearsIt() {
        Branch hq = branch(true, true);
        service.archive(hq.getId());
        assertFalse(hq.isActive());
        assertFalse(hq.isHeadquarters());
    }

    @Test void restoringAnOldHeadquartersKeepsTheCurrentOne() {
        Branch old = branch(true, false);
        when(repo.existsByCompanyIdAndHeadquartersTrueAndActiveTrueAndIdNot(company, old.getId())).thenReturn(true);
        service.update(old.getId(), update(null, true));
        assertTrue(old.isActive());
        assertFalse(old.isHeadquarters());
        verify(repo, never()).clearHeadquartersExcept(any(), any());
    }

    @Test void restoringTheOnlyHeadquartersKeepsIt() {
        Branch old = branch(true, false);
        when(repo.existsByCompanyIdAndHeadquartersTrueAndActiveTrueAndIdNot(company, old.getId())).thenReturn(false);
        service.update(old.getId(), update(null, true));
        assertTrue(old.isHeadquarters());
    }

    @Test void archivedBranchesAreListedOnlyWhenAskedFor() {
        Branch archived = branch(false, false);
        when(repo.findAllByCompanyIdOrderByNameAsc(company)).thenReturn(List.of(archived));
        when(repo.findAllByCompanyIdAndActiveTrueOrderByNameAsc(company)).thenReturn(List.of());
        assertEquals(1, service.listForCompany(company, true).size());
        assertFalse(service.listForCompany(company, true).get(0).active());
        assertEquals(0, service.listForCompany(company).size());
        when(repo.findAllByOrderByNameAsc()).thenReturn(List.of(archived));
        assertEquals(1, service.listAll(true).size());
    }
}
