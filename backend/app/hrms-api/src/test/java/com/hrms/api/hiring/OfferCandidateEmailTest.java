package com.hrms.api.hiring;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.hrms.api.mail.EmailMessage;
import com.hrms.api.mail.MailService;
import com.hrms.core.exception.BusinessRuleException;
import com.hrms.employee.workforce.entity.Company;
import com.hrms.employee.workforce.repository.WorkforceCompanyRepository;
import com.hrms.hiring.dto.HiringOfferRequest;
import com.hrms.hiring.dto.HiringOfferResponse;
import com.hrms.hiring.entity.Candidate;
import com.hrms.hiring.entity.HiringOffer;
import com.hrms.hiring.enums.CandidateStage;
import com.hrms.hiring.enums.OfferStatus;
import com.hrms.hiring.repository.CandidateRepository;
import com.hrms.hiring.repository.HiringOfferRepository;
import com.hrms.hiring.repository.JobRequisitionRepository;
import com.hrms.hiring.service.CandidateStageLog;
import com.hrms.hiring.service.HiringService;
import com.hrms.hiring.service.OfferEmailBook;
import com.hrms.letters.service.PdfRenderer;
import com.unifiedtree.security.tenant.TenantContext;
import jakarta.persistence.EntityManager;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.transaction.support.TransactionOperations;

import java.math.BigDecimal;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;

/** BW-67: the candidate email stored on an offer, its fallback, and one-click send. */
class OfferCandidateEmailTest {

    /** An in-memory offer email table; {@code present=false} behaves like a database without V143.59. */
    static final class MemoryBook implements OfferEmailBook {
        final Map<UUID, String> rows = new HashMap<>();
        boolean present = true;
        @Override public boolean save(UUID offerId, String email) {
            if (!present) return false;
            if (email == null) rows.remove(offerId); else rows.put(offerId, email);
            return true;
        }
        @Override public Map<UUID, String> find(Collection<UUID> ids) {
            Map<UUID, String> out = new HashMap<>();
            if (present) ids.forEach(id -> { if (rows.containsKey(id)) out.put(id, rows.get(id)); });
            return out;
        }
    }

    private final HiringOfferRepository offers = mock(HiringOfferRepository.class);
    private final CandidateRepository candidates = mock(CandidateRepository.class);
    private final MemoryBook book = new MemoryBook();
    private final JobRequisitionRepository requisitions = mock(JobRequisitionRepository.class);
    private final HiringService hiring = new HiringService(requisitions, candidates, offers, CandidateStageLog.NONE, book);

    @BeforeEach void tenant() { TenantContext.setTenantId(UUID.randomUUID()); }
    @AfterEach void clear() { TenantContext.clear(); }

    private HiringOffer draft(UUID candidateId) {
        HiringOffer o = new HiringOffer();
        o.setId(UUID.randomUUID());
        o.setCompanyId(UUID.randomUUID());
        o.setStatus(OfferStatus.DRAFT);
        o.setCandidateId(candidateId);
        o.setCandidateName("Asha");
        o.setRoleTitle("Engineer");
        o.setOfferedCtc(BigDecimal.TEN);
        o.setOfferTerms("Approved terms");
        when(offers.findById(o.getId())).thenReturn(Optional.of(o));
        when(offers.findForUpdate(o.getId())).thenReturn(Optional.of(o));
        when(offers.save(o)).thenReturn(o);
        when(offers.saveAndFlush(o)).thenReturn(o);
        return o;
    }

    private Candidate candidate(String email) {
        Candidate c = new Candidate();
        c.setId(UUID.randomUUID());
        c.setEmail(email);
        c.setStage(CandidateStage.SCREENING);
        c.setRequisitionId(UUID.randomUUID());
        when(candidates.findById(c.getId())).thenReturn(Optional.of(c));
        when(candidates.findAllById(any())).thenReturn(List.of(c));
        return c;
    }

    private HiringOfferRequest edit(HiringOffer o, String email) {
        return new HiringOfferRequest(o.getCompanyId(), null, null, "Asha", "Engineer", BigDecimal.TEN, null, null, null,
                "Approved terms", email);
    }

    @Test void theStoredEmailIsReturnedOnTheOffer() {
        HiringOffer o = draft(null);
        book.rows.put(o.getId(), "asha@example.test");
        assertEquals("asha@example.test", hiring.getOffer(o.getId()).candidateEmail());
    }

    @Test void withoutAStoredEmailTheLinkedCandidatesEmailIsTheFallback() {
        Candidate c = candidate("asha.candidate@example.test");
        HiringOffer o = draft(c.getId());
        assertEquals("asha.candidate@example.test", hiring.getOffer(o.getId()).candidateEmail());
    }

    @Test void withNeitherTheEmailIsEmpty() {
        HiringOffer o = draft(null);
        assertNull(hiring.getOffer(o.getId()).candidateEmail());
    }

    @Test void anEditThatLeavesTheEmailOutKeepsIt() {
        HiringOffer o = draft(null);
        book.rows.put(o.getId(), "asha@example.test");
        hiring.updateOffer(o.getId(), new HiringOfferRequest(o.getCompanyId(), null, null, "Asha", "Engineer",
                BigDecimal.TEN, null, null, null, "Approved terms"));
        assertEquals("asha@example.test", book.rows.get(o.getId()));
    }

    @Test void anEditWithAnEmptyEmailRemovesIt() {
        HiringOffer o = draft(null);
        book.rows.put(o.getId(), "asha@example.test");
        hiring.updateOffer(o.getId(), edit(o, "  "));
        assertFalse(book.rows.containsKey(o.getId()));
    }

    @Test void anEditStoresATypedEmail() {
        HiringOffer o = draft(null);
        HiringOfferResponse r = hiring.updateOffer(o.getId(), edit(o, " asha@example.test "));
        assertEquals("asha@example.test", book.rows.get(o.getId()));
        assertEquals("asha@example.test", r.candidateEmail());
    }

    @Test void aLinkedCandidateOnlyTakesTheirOwnRecordedEmail() {
        Candidate c = candidate("asha.candidate@example.test");
        HiringOffer o = draft(null);
        var requisition = new com.hrms.hiring.entity.JobRequisition();
        requisition.setId(c.getRequisitionId());
        requisition.setCompanyId(o.getCompanyId());
        when(requisitions.findById(c.getRequisitionId())).thenReturn(Optional.of(requisition));
        HiringOfferRequest other = new HiringOfferRequest(o.getCompanyId(), c.getRequisitionId(), c.getId(), "Asha", "Engineer",
                BigDecimal.TEN, null, null, null, "Approved terms", "someone.else@example.test");
        BusinessRuleException e = assertThrows(BusinessRuleException.class, () -> hiring.updateOffer(o.getId(), other));
        assertEquals("OFFER_EMAIL_MISMATCH", e.getErrorCode());
        assertTrue(book.rows.isEmpty());
    }

    @Test void withoutTheTableTheEditStillSavesAndTheEmailFallsBack() {
        book.present = false;
        HiringOffer o = draft(null);
        HiringOfferResponse r = hiring.updateOffer(o.getId(), edit(o, "asha@example.test"));
        assertNull(r.candidateEmail(), "not stored while V143.59 is missing, so Send asks for it as before");
        verify(offers).save(o);
    }

    // ── one-click send ──────────────────────────────────────────────────────

    private OfferDeliveryService delivery(MailService mail) {
        var companies = mock(WorkforceCompanyRepository.class);
        var company = new Company();
        company.setName("Test company");
        when(companies.findById(any())).thenReturn(Optional.of(company));
        var renderer = mock(PdfRenderer.class);
        when(renderer.render(anyString())).thenReturn(new byte[]{1});
        return new OfferDeliveryService(offers, candidates, hiring, companies, renderer, mail,
                new OfferDeliveryFailureTest.MemoryAttempts(), TransactionOperations.withoutTransaction());
    }

    @Test void sendWithoutATypedAddressUsesTheOffersCandidateEmail() {
        HiringOffer o = draft(null);
        book.rows.put(o.getId(), "asha@example.test");
        MailService mail = mock(MailService.class);
        HiringOfferResponse r = delivery(mail).send(o.getId(), null, "hr@example.test");
        var captor = org.mockito.ArgumentCaptor.forClass(EmailMessage.class);
        verify(mail).send(captor.capture());
        assertEquals("asha@example.test", captor.getValue().to());
        assertEquals("asha@example.test", r.emailRecipient());
    }

    @Test void sendWithoutAnyAddressIsRefusedAndSendsNothing() {
        HiringOffer o = draft(null);
        MailService mail = mock(MailService.class);
        BusinessRuleException e = assertThrows(BusinessRuleException.class, () -> delivery(mail).send(o.getId(), " ", null));
        assertEquals("OFFER_EMAIL_REQUIRED", e.getErrorCode());
        verifyNoInteractions(mail);
    }

    @Test void aTypedAddressStillWinsAsBefore() {
        HiringOffer o = draft(null);
        book.rows.put(o.getId(), "asha@example.test");
        MailService mail = mock(MailService.class);
        delivery(mail).send(o.getId(), "typed@example.test", null);
        var captor = org.mockito.ArgumentCaptor.forClass(EmailMessage.class);
        verify(mail).send(captor.capture());
        assertEquals("typed@example.test", captor.getValue().to());
    }

    // ── the JDBC table ──────────────────────────────────────────────────────

    @Test void theTableIsLookedUpFirstSoAMissingTableNeverAbortsTheTransaction() {
        FakeJdbc db = new FakeJdbc().tables(Map.of());
        JdbcOfferEmailBook jdbcBook = new JdbcOfferEmailBook(db.jdbc, mock(EntityManager.class));
        assertFalse(jdbcBook.save(UUID.randomUUID(), "asha@example.test"));
        assertTrue(jdbcBook.find(List.of(UUID.randomUUID())).isEmpty());
        assertTrue(db.callsContaining("offer_candidate_emails").isEmpty());
    }

    @Test void savingFlushesTheNewOfferThenUpserts() {
        FakeJdbc db = new FakeJdbc().tables(Map.of(JdbcOfferEmailBook.TABLE, true));
        EntityManager em = mock(EntityManager.class);
        assertTrue(new JdbcOfferEmailBook(db.jdbc, em).save(UUID.randomUUID(), " asha@example.test "));
        verify(em).flush();
        var upsert = db.callsContaining("ON CONFLICT (tenant_id, offer_id) DO UPDATE");
        assertEquals(1, upsert.size());
        assertEquals("asha@example.test", upsert.get(0).args().get(2));
    }

    // ── API shape ───────────────────────────────────────────────────────────

    @Test void requestsWithAndWithoutTheEmailBothRead() throws Exception {
        ObjectMapper json = new ObjectMapper().findAndRegisterModules();
        HiringOfferRequest old = json.readValue("{\"candidateName\":\"A\",\"roleTitle\":\"R\",\"offeredCtc\":10}", HiringOfferRequest.class);
        assertNull(old.candidateEmail());
        HiringOfferRequest now = json.readValue("{\"candidateName\":\"A\",\"roleTitle\":\"R\",\"offeredCtc\":10,\"candidateEmail\":\"a@b.test\"}",
                HiringOfferRequest.class);
        assertEquals("a@b.test", now.candidateEmail());
    }

    @Test void theResponseKeepsEveryOldFieldAndAddsTheEmail() throws Exception {
        ObjectMapper json = new ObjectMapper().findAndRegisterModules();
        HiringOffer o = draft(null);
        book.rows.put(o.getId(), "asha@example.test");
        var tree = json.valueToTree(hiring.getOffer(o.getId()));
        for (String field : List.of("id", "companyId", "requisitionId", "candidateId", "candidateName", "roleTitle", "offeredCtc",
                "joiningDate", "status", "sentAt", "respondedAt", "notes", "createdAt", "offerTerms", "emailSubmittedAt", "emailRecipient")) {
            assertTrue(tree.has(field), field);
        }
        assertEquals("asha@example.test", tree.get("candidateEmail").asText());
    }
}
