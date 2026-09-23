package com.hrms.api.hiring;

import com.hrms.api.mail.*;
import com.hrms.core.exception.BusinessRuleException;
import com.hrms.employee.workforce.entity.Company;
import com.hrms.employee.workforce.repository.WorkforceCompanyRepository;
import com.hrms.hiring.entity.HiringOffer;
import com.hrms.hiring.enums.OfferStatus;
import com.hrms.hiring.repository.*;
import com.hrms.hiring.service.HiringService;
import com.hrms.letters.service.PdfRenderer;
import org.junit.jupiter.api.Test;
import java.math.BigDecimal;
import java.util.Optional;
import java.util.UUID;
import static org.mockito.Mockito.*;
import static org.junit.jupiter.api.Assertions.*;

class OfferDeliveryTest {
    @Test void submitsPdfOnceAndDoesNotLeakInternalNotes() {
        var offers = mock(HiringOfferRepository.class);
        var candidates = mock(CandidateRepository.class);
        var companies = mock(WorkforceCompanyRepository.class);
        var renderer = mock(PdfRenderer.class);
        var mail = mock(MailService.class);
        var hiring = new HiringService(mock(JobRequisitionRepository.class), candidates, offers);
        var delivery = new OfferDeliveryService(offers, candidates, hiring, companies, renderer, mail);
        var offer = new HiringOffer(); offer.setId(UUID.randomUUID()); offer.setCompanyId(UUID.randomUUID());
        offer.setStatus(OfferStatus.DRAFT); offer.setOfferedCtc(BigDecimal.TEN);
        offer.setCandidateName("Candidate"); offer.setRoleTitle("Engineer");
        offer.setOfferTerms("Approved terms"); offer.setNotes("SECRET_INTERNAL_NOTE");
        when(offers.findForUpdate(offer.getId())).thenReturn(Optional.of(offer));
        when(offers.findById(offer.getId())).thenReturn(Optional.of(offer));
        when(offers.save(offer)).thenReturn(offer);
        var company = new Company(); company.setName("Test company");
        when(companies.findById(offer.getCompanyId())).thenReturn(Optional.of(company));
        when(renderer.render(anyString())).thenReturn(new byte[]{1,2,3});
        var response = delivery.send(offer.getId(), "candidate@example.test");
        assertNotNull(response.emailSubmittedAt()); assertEquals(OfferStatus.SENT, response.status());
        var captor = org.mockito.ArgumentCaptor.forClass(EmailMessage.class);
        verify(mail).send(captor.capture());
        assertFalse(captor.getValue().htmlBody().contains("SECRET_INTERNAL_NOTE"));
        assertEquals("application/pdf", captor.getValue().attachments().getFirst().contentType());
        delivery.send(offer.getId(), "candidate@example.test");
        verify(mail, times(1)).send(any());
        assertThrows(BusinessRuleException.class, () -> delivery.send(offer.getId(), "someone@example.test"));
    }
}
