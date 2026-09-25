package com.hrms.api.hiring;

import com.hrms.hiring.dto.CandidateResponse;
import com.hrms.hiring.entity.Candidate;
import com.hrms.hiring.enums.CandidateStage;
import com.hrms.hiring.repository.CandidateRepository;
import com.hrms.hiring.repository.HiringOfferRepository;
import com.hrms.hiring.repository.JobRequisitionRepository;
import com.hrms.hiring.service.HiringService;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** The pipeline's "All roles" board (and the dashboard's stage counts) list candidates across requisitions. */
class HiringAllCandidatesTest {
    private final CandidateRepository candidates = mock(CandidateRepository.class);
    private final HiringService service = new HiringService(mock(JobRequisitionRepository.class), candidates, mock(HiringOfferRepository.class));

    private Candidate candidate(UUID requisitionId, String name, CandidateStage stage) {
        Candidate c = new Candidate();
        c.setId(UUID.randomUUID());
        c.setRequisitionId(requisitionId);
        c.setFullName(name);
        c.setStage(stage);
        return c;
    }

    @Test
    void listsEveryRolesCandidatesForTheCompanyAndStage() {
        UUID company = UUID.randomUUID(), roleA = UUID.randomUUID(), roleB = UUID.randomUUID();
        when(candidates.findAcrossRequisitions(company, CandidateStage.INTERVIEW)).thenReturn(List.of(
                candidate(roleA, "Asha", CandidateStage.INTERVIEW), candidate(roleB, "Ravi", CandidateStage.INTERVIEW)));

        List<CandidateResponse> out = service.getCandidatesAcrossRequisitions(company, CandidateStage.INTERVIEW);

        assertEquals(List.of("Asha", "Ravi"), out.stream().map(CandidateResponse::fullName).toList());
        assertEquals(List.of(roleA, roleB), out.stream().map(CandidateResponse::requisitionId).toList(), "each keeps its own role");
    }

    @Test
    void noFiltersMeansEveryCandidateInTheWorkspace() {
        when(candidates.findAcrossRequisitions(null, null)).thenReturn(List.of());
        assertEquals(0, service.getCandidatesAcrossRequisitions(null, null).size());
        verify(candidates).findAcrossRequisitions(null, null);
    }
}
