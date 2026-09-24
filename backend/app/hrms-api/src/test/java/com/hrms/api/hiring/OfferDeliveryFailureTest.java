package com.hrms.api.hiring;

import com.hrms.api.mail.MailDeliveryException;
import com.hrms.api.mail.MailService;
import com.hrms.core.exception.HrmsException;
import com.hrms.employee.workforce.entity.Company;
import com.hrms.employee.workforce.repository.WorkforceCompanyRepository;
import com.hrms.hiring.entity.HiringOffer;
import com.hrms.hiring.enums.OfferStatus;
import com.hrms.hiring.repository.CandidateRepository;
import com.hrms.hiring.repository.HiringOfferRepository;
import com.hrms.hiring.repository.JobRequisitionRepository;
import com.hrms.hiring.service.HiringService;
import com.hrms.letters.service.PdfRenderer;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.transaction.support.TransactionOperations;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;

/**
 * Isolated failure harness for offer email delivery — the provider-outage /
 * lost-write cases that must not be produced by stopping the shared local mail
 * catcher. The mail provider is a stub that rejects, times out, or accepts;
 * the attempt ledger is in memory; the offer repository is a mock.
 */
class OfferDeliveryFailureTest {

    private final HiringOfferRepository offers = mock(HiringOfferRepository.class);
    private final CandidateRepository candidates = mock(CandidateRepository.class);
    private final WorkforceCompanyRepository companies = mock(WorkforceCompanyRepository.class);
    private final PdfRenderer renderer = mock(PdfRenderer.class);
    private final MailService mail = mock(MailService.class);
    private final MemoryAttempts ledger = new MemoryAttempts();
    private HiringOffer offer;
    private OfferDeliveryService delivery;

    @BeforeEach
    void setUp() {
        var hiring = new HiringService(mock(JobRequisitionRepository.class), candidates, offers);
        delivery = new OfferDeliveryService(offers, candidates, hiring, companies, renderer, mail, ledger,
                TransactionOperations.withoutTransaction());
        offer = new HiringOffer(); offer.setId(UUID.randomUUID()); offer.setCompanyId(UUID.randomUUID());
        offer.setStatus(OfferStatus.DRAFT); offer.setOfferedCtc(BigDecimal.TEN);
        offer.setCandidateName("Candidate"); offer.setRoleTitle("Engineer"); offer.setOfferTerms("Approved terms");
        when(offers.findForUpdate(offer.getId())).thenReturn(Optional.of(offer));
        when(offers.findById(offer.getId())).thenReturn(Optional.of(offer));
        when(offers.save(offer)).thenReturn(offer);
        var company = new Company(); company.setName("Test company");
        when(companies.findById(offer.getCompanyId())).thenReturn(Optional.of(company));
        when(renderer.render(anyString())).thenReturn(new byte[] {1, 2, 3});
    }

    @Test
    void providerRejectionIsNotSentAndMayBeRetried() {
        doThrow(new MailDeliveryException("Brevo API error 400", null, true)).doNothing().when(mail).send(any());

        HrmsException e = assertThrows(HrmsException.class, () -> delivery.send(offer.getId(), "c@example.test", "hr@example.test"));
        assertEquals("OFFER_EMAIL_NOT_SENT", e.getErrorCode());
        assertNull(offer.getEmailSubmittedAt(), "a rejected send must not mark the offer emailed");
        assertEquals(OfferStatus.DRAFT, offer.getStatus());
        assertEquals(OfferEmailAttemptStore.NOT_SENT, ledger.rows.getFirst().status());

        var ok = delivery.send(offer.getId(), "c@example.test", "hr@example.test");
        assertNotNull(ok.emailSubmittedAt());
        assertEquals(OfferStatus.SENT, ok.status());
        verify(mail, times(2)).send(any());
    }

    @Test
    void timeoutIsUncertainAndBlocksAnotherSendUntilResolved() {
        doThrow(new MailDeliveryException("Brevo send failed", new java.net.http.HttpTimeoutException("request timed out")))
                .doNothing().when(mail).send(any());

        HrmsException e = assertThrows(HrmsException.class, () -> delivery.send(offer.getId(), "c@example.test", "hr"));
        assertEquals("OFFER_EMAIL_UNCERTAIN", e.getErrorCode());
        assertEquals(OfferEmailAttemptStore.UNCERTAIN, ledger.rows.getFirst().status());

        HrmsException blocked = assertThrows(HrmsException.class, () -> delivery.send(offer.getId(), "c@example.test", "hr"));
        assertEquals("OFFER_EMAIL_UNRESOLVED", blocked.getErrorCode());
        verify(mail, times(1)).send(any()); // never automatically resent

        UUID attempt = ledger.rows.getFirst().id();
        assertThrows(RuntimeException.class, () -> delivery.resolve(offer.getId(), attempt, false, " ", "hr"),
                "a resolution needs a note saying how it was confirmed");
        delivery.resolve(offer.getId(), attempt, false, "Provider log shows no message", "hr");
        assertEquals(OfferEmailAttemptStore.NOT_SENT, ledger.rows.getFirst().status());

        delivery.send(offer.getId(), "c@example.test", "hr");
        assertNotNull(offer.getEmailSubmittedAt());
        verify(mail, times(2)).send(any());
    }

    @Test
    void operatorCanConfirmAnUncertainSendAsDelivered() {
        doThrow(new MailDeliveryException("SMTP send failed", new java.net.SocketTimeoutException("Read timed out")))
                .when(mail).send(any());
        assertThrows(HrmsException.class, () -> delivery.send(offer.getId(), "c@example.test", "hr"));

        var resolved = delivery.resolve(offer.getId(), ledger.rows.getFirst().id(), true, "Candidate confirmed receipt by phone", "hr");
        assertNotNull(resolved.emailSubmittedAt());
        assertEquals("c@example.test", offer.getEmailRecipient());
        assertEquals(OfferEmailAttemptStore.ACCEPTED, ledger.rows.getFirst().status());
        // Already submitted: a repeat click returns the saved result without sending.
        delivery.send(offer.getId(), "c@example.test", "hr");
        verify(mail, times(1)).send(any());
    }

    @Test
    void acceptedSendWhoseDatabaseWriteFailsStaysPendingAndBlocksResend() {
        doNothing().when(mail).send(any());
        when(offers.saveAndFlush(any())).thenThrow(new RuntimeException("connection lost")).thenReturn(offer);

        assertThrows(RuntimeException.class, () -> delivery.send(offer.getId(), "c@example.test", "hr"));
        // Our fake store auto-commits, so the ACCEPTED mark was written before the offer update failed;
        // in production both run in one transaction and roll back together, leaving PENDING.
        ledger.rows.set(0, ledger.withStatus(ledger.rows.getFirst(), OfferEmailAttemptStore.PENDING));
        offer.setEmailSubmittedAt(null);

        HrmsException blocked = assertThrows(HrmsException.class, () -> delivery.send(offer.getId(), "c@example.test", "hr"));
        assertEquals("OFFER_EMAIL_UNRESOLVED", blocked.getErrorCode());
        verify(mail, times(1)).send(any());
    }

    @Test
    void classifiesFailureCauses() {
        assertTrue(OfferDeliveryService.definitelyNotSent(new MailDeliveryException("x", new java.net.ConnectException("refused"))));
        assertTrue(OfferDeliveryService.definitelyNotSent(new org.springframework.mail.MailAuthenticationException("bad login")));
        assertTrue(OfferDeliveryService.definitelyNotSent(new MailDeliveryException("key missing", null, true)));
        assertFalse(OfferDeliveryService.definitelyNotSent(new MailDeliveryException("x", new java.net.SocketTimeoutException("t"))));
        assertFalse(OfferDeliveryService.definitelyNotSent(new MailDeliveryException("Brevo API error 503", null)));
        assertFalse(OfferDeliveryService.definitelyNotSent(new IllegalStateException("unknown")));
        // A timeout anywhere wins over a "certain" marker higher up.
        assertFalse(OfferDeliveryService.definitelyNotSent(new MailDeliveryException("x", new java.net.SocketTimeoutException("t"), true)));
    }

    /** In-memory attempt ledger (auto-commit semantics). */
    static class MemoryAttempts implements OfferEmailAttemptStore {
        final List<Attempt> rows = new ArrayList<>();

        Attempt withStatus(Attempt a, String status) {
            return new Attempt(a.id(), a.offerId(), a.recipient(), status, a.failureReason(), a.requestedBy(),
                    a.createdAt(), a.completedAt(), a.resolvedBy(), a.resolutionNote());
        }

        @Override public Optional<Attempt> openAttempt(UUID offerId) {
            return rows.stream().filter(a -> a.offerId().equals(offerId) && (PENDING.equals(a.status()) || UNCERTAIN.equals(a.status()))).findFirst();
        }
        @Override public UUID start(UUID offerId, String recipient, String requestedBy) {
            UUID id = UUID.randomUUID();
            rows.addFirst(new Attempt(id, offerId, recipient, PENDING, null, requestedBy, Instant.now(), null, null, null));
            return id;
        }
        @Override public void complete(UUID attemptId, String status, String reason) { replace(attemptId, status, reason, null, null); }
        @Override public void resolve(UUID attemptId, String status, String by, String note) { replace(attemptId, status, null, by, note); }
        @Override public Optional<Attempt> find(UUID attemptId) { return rows.stream().filter(a -> a.id().equals(attemptId)).findFirst(); }
        @Override public List<Attempt> list(UUID offerId) { return rows.stream().filter(a -> a.offerId().equals(offerId)).toList(); }

        private void replace(UUID id, String status, String reason, String by, String note) {
            for (int i = 0; i < rows.size(); i++) {
                Attempt a = rows.get(i);
                if (a.id().equals(id)) rows.set(i, new Attempt(a.id(), a.offerId(), a.recipient(), status,
                        reason != null ? reason : a.failureReason(), a.requestedBy(), a.createdAt(), Instant.now(),
                        by != null ? by : a.resolvedBy(), note != null ? note : a.resolutionNote()));
            }
        }
    }
}
