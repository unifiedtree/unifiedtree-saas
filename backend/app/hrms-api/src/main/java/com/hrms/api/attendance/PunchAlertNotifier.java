package com.hrms.api.attendance;

import com.hrms.attendance.dto.PunchInRecordedEvent;
import com.unifiedtree.notifications.service.NotificationDispatcher;
import jakarta.annotation.PreDestroy;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.Executor;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Punch-in alerts (V143.72): after a punch-in commits, tells the person's
 * reporting manager and the people and roles the company chose (HR
 * configuration, {@link PunchAlertSettingsService}) when, how and exactly where
 * they punched in, through the existing pipeline ({@link NotificationDispatcher}:
 * {@code attendance.punch_in_alert}, in the app and on the phone, each person's
 * choices and the company's template if any).
 *
 * <p><b>Never in the punch's way.</b> The listener runs after the commit and
 * only hands the event to this class's own background thread; everything else
 * (the lookups, the sending) happens there, with the tenant bound for that
 * thread. A full queue drops the alert with a warning, and every failure is
 * logged, never thrown, so an alert can't slow a punch down, fail it or undo it.
 * Alerts are best effort: one still waiting when the server stops is lost.
 *
 * <p>Nothing is sent until the settings table exists (the migration switches
 * the alerts on), for punches HR enters by hand (they publish no event), or to
 * the person who punched.
 */
@Component
public class PunchAlertNotifier {

    private static final Logger log = LoggerFactory.getLogger(PunchAlertNotifier.class);
    static final String EVENT_KEY = "attendance.punch_in_alert";

    private final PunchAlertSettingsService settings;
    private final PunchAlertFacts facts;
    private final NotificationDispatcher dispatcher;
    private final JdbcTemplate jdbc;
    private final TransactionTemplate readTx;
    private final Executor executor;
    private final ExecutorService ownPool;

    /** "Anywhere (no geofence)" per person: such a punch-in outside the office isn't an exception. */
    @Autowired(required = false)
    private PunchRulesService punchRules;

    @Autowired
    public PunchAlertNotifier(PunchAlertSettingsService settings, PunchAlertFacts facts, NotificationDispatcher dispatcher,
                              JdbcTemplate jdbc, PlatformTransactionManager txManager) {
        this(settings, facts, dispatcher, jdbc, txManager, null);
    }

    /** @param executor where the alerts are worked out and sent; null for this class's own single background thread */
    PunchAlertNotifier(PunchAlertSettingsService settings, PunchAlertFacts facts, NotificationDispatcher dispatcher,
                       JdbcTemplate jdbc, PlatformTransactionManager txManager, Executor executor) {
        this.settings = settings;
        this.facts = facts;
        this.dispatcher = dispatcher;
        this.jdbc = jdbc;
        this.readTx = new TransactionTemplate(txManager);
        this.readTx.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        this.readTx.setReadOnly(true);
        if (executor != null) {
            this.executor = executor;
            this.ownPool = null;
        } else {
            // One thread: alerts go out in the order people punched, and at most one
            // database connection is busy with them. A morning rush queues up here.
            AtomicInteger n = new AtomicInteger();
            this.ownPool = new ThreadPoolExecutor(1, 1, 60, TimeUnit.SECONDS, new LinkedBlockingQueue<>(2000),
                    r -> {
                        Thread t = new Thread(r, "punch-alerts-" + n.incrementAndGet());
                        t.setDaemon(true);
                        return t;
                    },
                    (r, pool) -> log.warn("Punch-in alert dropped: the alert queue is full"));
            this.executor = this.ownPool;
        }
    }

    @PreDestroy
    void stop() {
        if (ownPool != null) ownPool.shutdownNow();
    }

    /** After the punch commits: hand it to the background thread, and nothing else. */
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT, fallbackExecution = true)
    public void onPunchIn(PunchInRecordedEvent event) {
        if (event == null || event.tenantId() == null || event.employeeId() == null) return;
        try {
            executor.execute(() -> sendSafely(event));
        } catch (RuntimeException e) {
            log.warn("Punch-in alert for record {} not queued: {}", event.attendanceRecordId(), e.getMessage());
        }
    }

    /** On the background thread: the tenant bound for this thread, every failure logged. */
    void sendSafely(PunchInRecordedEvent event) {
        com.unifiedtree.security.tenant.TenantContext.setTenantId(event.tenantId());
        com.hrms.core.tenant.TenantContext.setTenantId(event.tenantId());
        try {
            int sent = send(event);
            if (sent > 0) log.info("Punch-in alert for record {} sent to {} people", event.attendanceRecordId(), sent);
        } catch (Throwable e) {
            log.warn("Punch-in alert for record {} not sent: {}", event.attendanceRecordId(), e.toString());
        } finally {
            com.unifiedtree.security.tenant.TenantContext.clear();
            com.hrms.core.tenant.TenantContext.clear();
        }
    }

    /** Everything one alert needs, read in one go. */
    private record Plan(List<UUID> recipients, PunchAlerts.Alert alert) {}

    /**
     * Works out who gets the alert and sends it to each of them; one failed
     * recipient never stops the others. Returns how many it was handed to.
     */
    int send(PunchInRecordedEvent e) {
        UUID tenantId = e.tenantId();
        Plan plan = readTx.execute(status -> plan(e));
        if (plan == null || plan.recipients().isEmpty()) return 0;
        Map<String, String> values = PunchAlerts.values(plan.alert());
        Map<String, Object> data = PunchAlerts.data(plan.alert());
        int sent = 0;
        for (UUID to : plan.recipients()) {
            try {
                dispatcher.dispatch(tenantId, to, EVENT_KEY, values, data);
                sent++;
            } catch (Exception ex) {
                log.warn("Punch-in alert for record {} to {} failed: {}", e.attendanceRecordId(), to, ex.getMessage());
            }
        }
        return sent;
    }

    /** Null when no alert goes out: alerts not switched on, or the person isn't in this workspace. */
    private Plan plan(PunchInRecordedEvent e) {
        UUID tenantId = e.tenantId();
        jdbc.queryForObject("SELECT set_config('app.tenant_id', ?, true)", String.class, tenantId.toString());
        PunchAlertFacts.Person person = facts.person(tenantId, e.employeeId());
        if (person == null) return null;
        UUID companyId = e.companyId() != null ? e.companyId() : person.companyId();
        Optional<PunchAlertSettingsService.Rules> found = settings.rulesFor(tenantId, companyId);
        if (found.isEmpty()) return null;
        PunchAlertSettingsService.Rules rules = found.get();

        if (!rules.notifyManager() && rules.employeeIds().isEmpty() && rules.roleIds().isEmpty()) return null;

        PunchAlertFacts.Assisted assisted = facts.assisted(tenantId, e.attendanceRecordId());
        Double accuracy = e.accuracyMeters() != null ? e.accuracyMeters() : assisted != null ? assisted.accuracyMeters() : null;
        PunchAlerts.Where where = PunchAlerts.where(e.latitude(), e.longitude(),
                facts.places(tenantId, companyId, person.zoneId(), person.branchId()));
        boolean anywhere = punchRules != null && punchRules.allowAnywhere(e.employeeId());
        boolean exception = PunchAlerts.isException(e.late(), where, e.wfhDay(), anywhere);
        if (rules.onlyExceptions() && !exception) return null;

        PunchAlerts.Candidate manager = rules.notifyManager() && person.managerId() != null
                ? facts.candidates(tenantId, List.of(person.managerId())).stream().findFirst().orElse(null) : null;
        List<UUID> recipients = PunchAlerts.recipients(rules, e.employeeId(), companyId, manager,
                facts.candidates(tenantId, rules.employeeIds()), facts.roleHolders(tenantId, companyId, rules.roleIds()),
                exception);
        PunchAlerts.Alert alert = new PunchAlerts.Alert(e.attendanceRecordId(), e.employeeId(), person.name(),
                e.attendanceDate(), e.checkInAt(), e.receivedAt(), e.offlineCaptured(), e.method(),
                assisted != null, assisted != null ? assisted.punchedByName() : null,
                e.latitude(), e.longitude(), accuracy, where, e.late(), e.lateByMinutes(), e.wfhDay());
        return new Plan(recipients, alert);
    }
}
