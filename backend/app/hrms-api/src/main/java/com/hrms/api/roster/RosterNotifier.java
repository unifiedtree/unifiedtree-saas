package com.hrms.api.roster;

import com.hrms.api.roster.RosterContract.ChangeKind;
import com.hrms.api.roster.RosterPublishedEvent.Change;
import com.unifiedtree.notifications.enums.AppNotificationType;
import com.unifiedtree.notifications.service.NotificationDispatcher;
import jakarta.annotation.PreDestroy;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.Executor;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Tells people about a published roster (D-S12, design §1.8), through the existing pipeline
 * ({@link NotificationDispatcher}: in the app and on the phone, each person's notification choices,
 * the company's template if any).
 * <ul>
 *   <li>{@code roster.published} (ROSTER_PUBLISHED) to each person who now has a published day of the
 *       roster from today on and had none before: everyone at the first publish, and people added
 *       later.</li>
 *   <li>{@code roster.day_changed} (ROSTER_DAY_CHANGED) to everyone else with a day added, changed or
 *       removed by this publish (people taken off the roster too), saying which.</li>
 * </ul>
 * Only after the publish commits, on this class's own background thread, one dispatch per person;
 * every failure is logged and never thrown, so a notice can never slow down, fail or undo a publish.
 * Nothing is sent for drafts, saves or imports. {@code data.route} is always set: app builds that
 * don't know these types yet open it, or their alerts list.
 */
@Component
public class RosterNotifier {

    private static final Logger log = LoggerFactory.getLogger(RosterNotifier.class);
    static final String PUBLISHED = "roster.published";
    static final String DAY_CHANGED = "roster.day_changed";
    /** The app's My Schedule screen (Phase 2); until it exists the app opens its alerts list. */
    static final String ROUTE = "/my-schedule";

    private static final DateTimeFormatter DAY_MONTH = DateTimeFormatter.ofPattern("d MMM", Locale.ENGLISH);

    private final NotificationDispatcher dispatcher;
    private final Executor executor;
    private final ExecutorService ownPool;

    @Autowired
    public RosterNotifier(NotificationDispatcher dispatcher) {
        this(dispatcher, null);
    }

    /** @param executor where the notices are sent; null for this class's own single background thread */
    RosterNotifier(NotificationDispatcher dispatcher, Executor executor) {
        this.dispatcher = dispatcher;
        if (executor != null) {
            this.executor = executor;
            this.ownPool = null;
        } else {
            AtomicInteger n = new AtomicInteger();
            this.ownPool = new ThreadPoolExecutor(1, 1, 60, TimeUnit.SECONDS, new LinkedBlockingQueue<>(200),
                    r -> {
                        Thread t = new Thread(r, "roster-notices-" + n.incrementAndGet());
                        t.setDaemon(true);
                        return t;
                    },
                    (r, pool) -> log.warn("Roster notices dropped: the queue is full"));
            this.executor = this.ownPool;
        }
    }

    @PreDestroy
    void stop() {
        if (ownPool != null) ownPool.shutdownNow();
    }

    // ── who gets what (pure) ──────────────────────────────────────────────────

    /** {@code published}: told their schedule is ready; {@code changed}: told which of their days changed. */
    public record Recipients(Set<UUID> published, Map<UUID, List<Change>> changed) {
        public int count() {
            return published.size() + changed.size();
        }
    }

    static Recipients recipients(Set<UUID> hadDaysBefore, Set<UUID> haveDaysNow, List<Change> changes) {
        Set<UUID> published = new LinkedHashSet<>(haveDaysNow);
        published.removeAll(hadDaysBefore);
        Map<UUID, List<Change>> changed = new LinkedHashMap<>();
        for (Change c : changes) {
            if (published.contains(c.employeeId())) continue;
            changed.computeIfAbsent(c.employeeId(), k -> new ArrayList<>()).add(c);
        }
        return new Recipients(published, changed);
    }

    /** "12 Oct is now B (Evening, 14:00–22:00), and 2 more days." */
    static String changeText(List<Change> changes) {
        List<Change> sorted = new ArrayList<>(changes);
        sorted.sort(Comparator.comparing(Change::date));
        Change first = sorted.get(0);
        String day = first.date().format(DAY_MONTH);
        String what;
        if (first.change() == ChangeKind.REMOVED) what = day + " is no longer planned";
        else if (RosterStore.WO.equals(first.newKind())) what = day + " is now a weekly off";
        else what = day + " is now " + (first.newText() == null ? "a different shift" : first.newText());
        int more = sorted.size() - 1;
        return more == 0 ? what + "." : what + ", and " + more + (more == 1 ? " more day." : " more days.");
    }

    // ── sending ───────────────────────────────────────────────────────────────

    /** After the publish commits: hand it to the background thread, and nothing else. */
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT, fallbackExecution = true)
    public void onPublished(RosterPublishedEvent event) {
        if (event == null || event.tenantId() == null) return;
        try {
            executor.execute(() -> sendSafely(event));
        } catch (RuntimeException e) {
            log.warn("Roster notices for {} not queued: {}", event.rosterId(), e.getMessage());
        }
    }

    void sendSafely(RosterPublishedEvent event) {
        com.unifiedtree.security.tenant.TenantContext.setTenantId(event.tenantId());
        com.hrms.core.tenant.TenantContext.setTenantId(event.tenantId());
        try {
            int sent = send(event);
            if (sent > 0) log.info("Roster {} published: {} people told", event.rosterId(), sent);
        } catch (Throwable e) {
            log.warn("Roster notices for {} not sent: {}", event.rosterId(), e.toString());
        } finally {
            com.unifiedtree.security.tenant.TenantContext.clear();
            com.hrms.core.tenant.TenantContext.clear();
        }
    }

    /** Sends each person their notice; one failure never stops the others. Returns how many were handed over. */
    int send(RosterPublishedEvent e) {
        Recipients r = recipients(e.hadDaysBefore(), e.haveDaysNow(), e.changes());
        int sent = 0;
        for (UUID to : r.published()) {
            Map<String, String> values = new HashMap<>();
            values.put("period", e.periodText());
            values.put("rosterName", e.rosterName());
            Map<String, Object> data = new HashMap<>();
            data.put("type", AppNotificationType.ROSTER_PUBLISHED.name());
            data.put("rosterId", e.rosterId().toString());
            data.put("from", e.from().toString());
            data.put("to", e.to().toString());
            data.put("route", ROUTE);
            if (dispatchSafely(e, to, PUBLISHED, values, data)) sent++;
        }
        for (Map.Entry<UUID, List<Change>> c : r.changed().entrySet()) {
            Map<String, String> values = new HashMap<>();
            values.put("changeText", changeText(c.getValue()));
            values.put("rosterName", e.rosterName());
            Map<String, Object> data = new HashMap<>();
            data.put("type", AppNotificationType.ROSTER_DAY_CHANGED.name());
            data.put("rosterId", e.rosterId().toString());
            data.put("dates", c.getValue().stream().map(Change::date).distinct().sorted().map(LocalDate::toString).toList());
            data.put("route", ROUTE);
            if (dispatchSafely(e, c.getKey(), DAY_CHANGED, values, data)) sent++;
        }
        return sent;
    }

    private boolean dispatchSafely(RosterPublishedEvent e, UUID to, String key, Map<String, String> values, Map<String, Object> data) {
        try {
            dispatcher.dispatch(e.tenantId(), to, key, values, data);
            return true;
        } catch (Exception ex) {
            log.warn("Roster notice {} for roster {} to {} failed: {}", key, e.rosterId(), to, ex.getMessage());
            return false;
        }
    }
}
