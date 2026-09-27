package com.hrms.api.hiring;

import com.hrms.core.exception.BusinessRuleException;
import com.hrms.hiring.dto.CandidateRequest;
import com.hrms.hiring.dto.CandidateStageRequest;
import com.hrms.hiring.dto.HiringOfferRequest;
import com.hrms.hiring.entity.Candidate;
import com.hrms.hiring.entity.HiringOffer;
import com.hrms.hiring.entity.JobRequisition;
import com.hrms.hiring.enums.CandidateStage;
import com.hrms.hiring.enums.OfferStatus;
import com.hrms.hiring.enums.RequisitionStatus;
import com.hrms.hiring.repository.CandidateRepository;
import com.hrms.hiring.repository.HiringOfferRepository;
import com.hrms.hiring.repository.JobRequisitionRepository;
import com.hrms.hiring.service.CandidateStageLog;
import com.hrms.hiring.service.HiringService;
import com.hrms.hiring.service.OfferEmailBook;
import com.unifiedtree.security.tenant.TenantContext;
import jakarta.persistence.EntityManager;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.InOrder;
import org.springframework.aop.framework.ProxyFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.transaction.IllegalTransactionStateException;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.annotation.AnnotationTransactionAttributeSource;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.interceptor.TransactionInterceptor;
import org.springframework.transaction.support.AbstractPlatformTransactionManager;
import org.springframework.transaction.support.DefaultTransactionStatus;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

/**
 * BW-66: every move of a candidate writes its history row, and in the SAME
 * transaction as the move. The no-skip rule is untouched: a new candidate
 * always starts at Applied.
 */
class CandidateStageHistoryTest {

    private final JobRequisitionRepository requisitions = mock(JobRequisitionRepository.class);
    private final CandidateRepository candidates = mock(CandidateRepository.class);
    private final HiringOfferRepository offers = mock(HiringOfferRepository.class);
    private final CandidateStageLog log = mock(CandidateStageLog.class);
    private final HiringService service = new HiringService(requisitions, candidates, offers, log, OfferEmailBook.NONE);
    private final UUID tenant = UUID.randomUUID();

    @BeforeEach void tenant() { TenantContext.setTenantId(tenant); TenantContext.setUserId(UUID.randomUUID()); }
    @AfterEach void clear() { TenantContext.clear(); }

    private JobRequisition openRequisition() {
        JobRequisition r = new JobRequisition();
        r.setId(UUID.randomUUID());
        r.setCompanyId(UUID.randomUUID());
        r.setStatus(RequisitionStatus.OPEN);
        when(requisitions.findById(r.getId())).thenReturn(Optional.of(r));
        return r;
    }

    private Candidate candidate(CandidateStage stage) {
        Candidate c = new Candidate();
        c.setId(UUID.randomUUID());
        c.setStage(stage);
        c.setRequisitionId(UUID.randomUUID());
        when(candidates.findById(c.getId())).thenReturn(Optional.of(c));
        when(candidates.findForUpdate(c.getId())).thenReturn(Optional.of(c));
        when(candidates.save(c)).thenReturn(c);
        return c;
    }

    private void savesWithId() {
        when(candidates.save(any(Candidate.class))).thenAnswer(inv -> {
            Candidate c = inv.getArgument(0);
            if (c.getId() == null) c.setId(UUID.randomUUID());
            return c;
        });
    }

    @Test void addingACandidateRecordsAddedAtAppliedAfterTheCandidateIsSaved() {
        JobRequisition r = openRequisition();
        savesWithId();
        var added = service.addCandidate(r.getId(), new CandidateRequest("Asha Rao", "asha@example.test", null, "Referral", null, null));
        assertEquals(CandidateStage.APPLIED, added.stage(), "a new candidate always starts at Applied (no-skip rule)");
        InOrder order = inOrder(candidates, log);
        order.verify(candidates).save(any(Candidate.class));
        order.verify(log).record(added.id(), null, CandidateStage.APPLIED, CandidateStageLog.Kind.ADDED);
    }

    @Test void aStageMoveRecordsFromAndTo() {
        Candidate c = candidate(CandidateStage.APPLIED);
        service.updateStage(c.getId(), new CandidateStageRequest(CandidateStage.SCREENING));
        verify(log).record(c.getId(), CandidateStage.APPLIED, CandidateStage.SCREENING, CandidateStageLog.Kind.STAGE_CHANGE);
    }

    @Test void savingTheSameStageRecordsNothing() {
        Candidate c = candidate(CandidateStage.INTERVIEW);
        service.updateStage(c.getId(), new CandidateStageRequest(CandidateStage.INTERVIEW));
        verifyNoInteractions(log);
    }

    @Test void aRefusedMoveRecordsNothing() {
        Candidate c = candidate(CandidateStage.APPLIED);
        assertThrows(BusinessRuleException.class,
                () -> service.updateStage(c.getId(), new CandidateStageRequest(CandidateStage.OFFER)), "skipping stages stays refused");
        verifyNoInteractions(log);
    }

    @Test void creatingAnOfferMovesAnInterviewCandidateToOfferAndRecordsIt() {
        Candidate c = candidate(CandidateStage.INTERVIEW);
        JobRequisition r = openRequisition();
        c.setRequisitionId(r.getId());
        when(offers.save(any(HiringOffer.class))).thenAnswer(inv -> { HiringOffer o = inv.getArgument(0); o.setId(UUID.randomUUID()); return o; });
        service.createOffer(r.getCompanyId(), new HiringOfferRequest(r.getCompanyId(), r.getId(), c.getId(), "Asha", "Engineer",
                BigDecimal.TEN, null, null, null, "terms"));
        assertEquals(CandidateStage.OFFER, c.getStage());
        verify(log).record(c.getId(), CandidateStage.INTERVIEW, CandidateStage.OFFER, CandidateStageLog.Kind.OFFER_CREATED);
    }

    @Test void creatingAnOfferForACandidateNotInInterviewRecordsNothing() {
        Candidate c = candidate(CandidateStage.SCREENING);
        JobRequisition r = openRequisition();
        c.setRequisitionId(r.getId());
        when(offers.save(any(HiringOffer.class))).thenAnswer(inv -> { HiringOffer o = inv.getArgument(0); o.setId(UUID.randomUUID()); return o; });
        service.createOffer(r.getCompanyId(), new HiringOfferRequest(r.getCompanyId(), r.getId(), c.getId(), "Asha", "Engineer",
                BigDecimal.TEN, null, null, null, "terms"));
        verifyNoInteractions(log);
    }

    @Test void anAcceptedOfferRecordsTheMoveToHired() {
        Candidate c = candidate(CandidateStage.OFFER);
        HiringOffer o = new HiringOffer();
        o.setId(UUID.randomUUID());
        o.setStatus(OfferStatus.SENT);
        o.setCandidateId(c.getId());
        when(offers.findForUpdate(o.getId())).thenReturn(Optional.of(o));
        when(offers.save(o)).thenReturn(o);
        service.updateOfferStatus(o.getId(), OfferStatus.ACCEPTED);
        verify(log).record(c.getId(), CandidateStage.OFFER, CandidateStage.HIRED, CandidateStageLog.Kind.OFFER_ACCEPTED);
    }

    @Test void conversionIsRecorded() {
        Candidate c = candidate(CandidateStage.HIRED);
        service.completeConversion(c.getId(), UUID.randomUUID());
        verify(log).record(c.getId(), CandidateStage.HIRED, CandidateStage.HIRED, CandidateStageLog.Kind.CONVERTED);
    }

    // ── the JDBC writer ─────────────────────────────────────────────────────

    @Test void everyNewBeanHasOneConstructorSpringCanUse() {
        for (Class<?> bean : List.of(JdbcCandidateStageLog.class, JdbcOfferEmailBook.class, HiringService.class,
                HiringInsightsService.class, HiringInsightsController.class,
                com.hrms.api.onboarding.AssetCareService.class, com.hrms.api.onboarding.OnboardingOverviewService.class,
                com.hrms.api.onboarding.AssetIssueNotifier.class, com.hrms.api.onboarding.OnboardingController.class,
                com.hrms.api.me.MyAssetsController.class)) {
            var ctors = bean.getDeclaredConstructors();
            long marked = java.util.Arrays.stream(ctors)
                    .filter(c -> c.isAnnotationPresent(org.springframework.beans.factory.annotation.Autowired.class)).count();
            assertTrue(ctors.length == 1 || marked == 1, bean.getSimpleName() + ": " + ctors.length + " constructors, " + marked + " marked @Autowired");
        }
    }

    @Test void theWriterRequiresTheCallersTransaction() throws Exception {
        Transactional tx = JdbcCandidateStageLog.class
                .getMethod("record", UUID.class, CandidateStage.class, CandidateStage.class, CandidateStageLog.Kind.class)
                .getAnnotation(Transactional.class);
        assertNotNull(tx);
        assertEquals(Propagation.MANDATORY, tx.propagation());
    }

    @Test void theWriterSkipsWhileTheTableIsMissingAndNeverTouchesIt() {
        FakeJdbc db = new FakeJdbc().tables(Map.of());
        EntityManager em = mock(EntityManager.class);
        new JdbcCandidateStageLog(db.jdbc, em).record(UUID.randomUUID(), null, CandidateStage.APPLIED, CandidateStageLog.Kind.ADDED);
        assertTrue(db.callsContaining("candidate_stage_events").isEmpty());
        verifyNoInteractions(em);
    }

    @Test void theWriterFlushesThePendingCandidateThenInsertsWithTenantAndActor() {
        FakeJdbc db = new FakeJdbc().tables(Map.of(JdbcCandidateStageLog.TABLE, true));
        EntityManager em = mock(EntityManager.class);
        UUID candidate = UUID.randomUUID();
        new JdbcCandidateStageLog(db.jdbc, em).record(candidate, CandidateStage.APPLIED, CandidateStage.SCREENING, CandidateStageLog.Kind.STAGE_CHANGE);
        verify(em).flush();
        var insert = db.callsContaining("INSERT INTO hiring_mgmt.candidate_stage_events");
        assertEquals(1, insert.size());
        assertEquals(List.of(tenant, candidate, "APPLIED", "SCREENING", "STAGE_CHANGE", TenantContext.getUserId()), insert.get(0).args());
    }

    // ── same transaction, through real Spring transaction proxies ───────────

    /** A transaction manager that only counts: begin, commit, rollback, and whether one is active. */
    static final class CountingTm extends AbstractPlatformTransactionManager {
        int begins, commits, rollbacks;
        boolean active;
        @Override protected Object doGetTransaction() { return new boolean[]{active}; }
        @Override protected boolean isExistingTransaction(Object tx) { return ((boolean[]) tx)[0]; }
        @Override protected void doBegin(Object tx, TransactionDefinition d) { active = true; begins++; }
        @Override protected void doCommit(DefaultTransactionStatus s) { commits++; }
        @Override protected void doRollback(DefaultTransactionStatus s) { rollbacks++; }
        @Override protected void doSetRollbackOnly(DefaultTransactionStatus s) { }
        @Override protected void doCleanupAfterCompletion(Object tx) { active = false; }
    }

    private record Wired(HiringService hiring, CandidateStageLog log, CountingTm tm, FakeJdbc db) {}

    private Wired wired(boolean insertFails) {
        CountingTm tm = new CountingTm();
        boolean[] activeAtInsert = {false};
        FakeJdbc db = new FakeJdbc().tables(Map.of(JdbcCandidateStageLog.TABLE, true))
                .on("INSERT INTO hiring_mgmt.candidate_stage_events", c -> {
                    activeAtInsert[0] = tm.active;
                    if (!tm.active) throw new AssertionError("history written outside a transaction");
                    if (insertFails) throw new DataIntegrityViolationException("boom");
                    return 1;
                });
        TransactionInterceptor interceptor = new TransactionInterceptor(tm, new AnnotationTransactionAttributeSource());
        ProxyFactory logProxy = new ProxyFactory(new JdbcCandidateStageLog(db.jdbc, mock(EntityManager.class)));
        logProxy.addInterface(CandidateStageLog.class);
        logProxy.addAdvice(interceptor);
        CandidateStageLog stageLog = (CandidateStageLog) logProxy.getProxy();
        ProxyFactory serviceProxy = new ProxyFactory(new HiringService(requisitions, candidates, offers, stageLog, OfferEmailBook.NONE));
        serviceProxy.setProxyTargetClass(true);
        serviceProxy.addAdvice(interceptor);
        return new Wired((HiringService) serviceProxy.getProxy(), stageLog, tm, db);
    }

    @Test void theMoveAndItsHistoryShareOneTransaction() {
        Wired w = wired(false);
        Candidate c = candidate(CandidateStage.APPLIED);
        w.hiring().updateStage(c.getId(), new CandidateStageRequest(CandidateStage.SCREENING));
        assertEquals(1, w.db().callsContaining("INSERT INTO hiring_mgmt.candidate_stage_events").size());
        assertEquals(1, w.tm().begins, "one transaction for the move and its history row");
        assertEquals(1, w.tm().commits);
    }

    @Test void aFailedHistoryWriteRollsTheMoveBack() {
        Wired w = wired(true);
        Candidate c = candidate(CandidateStage.APPLIED);
        assertThrows(DataIntegrityViolationException.class,
                () -> w.hiring().updateStage(c.getId(), new CandidateStageRequest(CandidateStage.SCREENING)));
        assertEquals(0, w.tm().commits);
        assertEquals(1, w.tm().rollbacks);
    }

    @Test void theHistoryCannotBeWrittenOnItsOwn() {
        Wired w = wired(false);
        assertThrows(IllegalTransactionStateException.class,
                () -> w.log().record(UUID.randomUUID(), null, CandidateStage.APPLIED, CandidateStageLog.Kind.ADDED));
        assertEquals(0, w.tm().begins);
        assertTrue(w.db().callsContaining("INSERT INTO hiring_mgmt.candidate_stage_events").isEmpty());
    }
}
