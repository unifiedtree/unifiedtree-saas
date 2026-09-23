package com.hrms.api.hiring;

import com.hrms.core.exception.BusinessRuleException;
import com.hrms.hiring.entity.HiringOffer;
import com.hrms.hiring.enums.OfferStatus;
import com.hrms.hiring.repository.CandidateRepository;
import com.hrms.hiring.repository.HiringOfferRepository;
import com.hrms.hiring.repository.JobRequisitionRepository;
import com.hrms.hiring.service.HiringService;
import org.junit.jupiter.api.Test;
import java.util.Optional;
import java.util.UUID;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class HiringOfferWorkflowTest {
    private final HiringOfferRepository offers = mock(HiringOfferRepository.class);
    private final HiringService service = new HiringService(mock(JobRequisitionRepository.class), mock(CandidateRepository.class), offers);

    private HiringOffer offer(OfferStatus status) {
        HiringOffer offer = new HiringOffer();
        offer.setId(UUID.randomUUID());
        offer.setStatus(status);
        when(offers.findById(offer.getId())).thenReturn(Optional.of(offer));
        when(offers.save(offer)).thenReturn(offer);
        return offer;
    }

    @Test void draftCannotBeAcceptedBeforeItIsSent() {
        HiringOffer offer = offer(OfferStatus.DRAFT);
        assertThrows(BusinessRuleException.class, () -> service.updateOfferStatus(offer.getId(), OfferStatus.ACCEPTED));
        verify(offers, never()).save(any());
    }

    @Test void decisionIsFinalAndCannotBeReopened() {
        for (OfferStatus status : new OfferStatus[]{OfferStatus.ACCEPTED, OfferStatus.DECLINED, OfferStatus.WITHDRAWN}) {
            HiringOffer offer = offer(status);
            assertThrows(BusinessRuleException.class, () -> service.updateOfferStatus(offer.getId(), OfferStatus.SENT));
        }
        verify(offers, never()).save(any());
    }

    @Test void sentOfferRecordsDecisionTime() {
        HiringOffer offer = offer(OfferStatus.SENT);
        assertEquals(OfferStatus.ACCEPTED, service.updateOfferStatus(offer.getId(), OfferStatus.ACCEPTED).status());
        assertNotNull(offer.getRespondedAt());
    }
}
