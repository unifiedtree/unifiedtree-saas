package com.hrms.api.approvals;

import com.hrms.api.attendance.TeamEmployeeScope;
import com.hrms.core.exception.HrmsException;
import com.unifiedtree.rbac.security.PermissionChecker;
import com.unifiedtree.security.tenant.TenantContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.EnumMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.function.Supplier;

/**
 * The Approvals inbox (redesign BW-09): every request waiting for the caller,
 * across leave, attendance fixes, work from home, shift changes and expense
 * claims, in one list, newest first, with per-tab counts, facts, warnings,
 * {@code canDecide}, {@code rejectNeedsReason} and the caller's decisions that
 * can still be undone.
 *
 * <p>Each kind is read on its own, in its own read-only transaction, so a kind
 * that fails is reported in {@code unavailable} and the rest still loads.
 * Decisions don't go through here: the page calls each kind's existing decide
 * endpoint, and Undo's.
 */
@Service
public class ApprovalsInboxService {

    private static final Logger log = LoggerFactory.getLogger(ApprovalsInboxService.class);
    static final int DEFAULT_SIZE = 20;
    static final int MAX_SIZE = 100;

    private final InboxQueries queries;
    private final TeamEmployeeScope teamScope;
    private final PermissionChecker perm;
    private final DecisionUndoService undo;
    private final TransactionTemplate readOnly;

    public ApprovalsInboxService(InboxQueries queries, TeamEmployeeScope teamScope, PermissionChecker perm,
                                 DecisionUndoService undo, PlatformTransactionManager txManager) {
        this.queries = queries;
        this.teamScope = teamScope;
        this.perm = perm;
        this.undo = undo;
        TransactionTemplate t = new TransactionTemplate(txManager);
        t.setReadOnly(true);
        t.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        this.readOnly = t;
    }

    /** The web's {@code ApprovalsInbox}. */
    public record Inbox(Map<String, Integer> counts, List<String> tabs, List<InboxQueries.Row> rows, int page, int size,
                        long totalElements, List<DecisionJournal.Recent> recentDecisions, List<String> unavailable) {
    }

    /** What this caller may list and decide, from the same permissions the list and decide endpoints read. */
    public InboxAccess access(Jwt jwt, Authentication auth) {
        return new InboxAccess(Callers.employeeId(jwt),
                perm.check("hrms.leave.approve.l1"),
                Callers.hasAuthority(auth, "wfh.approve"),
                Callers.hasAuthority(auth, "attendance.regularization.approve"),
                Callers.hasAuthority(auth, "attendance.regularization.approve"),
                Callers.hasAuthority(auth, "hrms.expense.claim.approve"),
                Callers.hasAuthority(auth, Callers.LEAVE_L2),
                Callers.hasClaim(jwt, Callers.WORKFORCE_ADMIN),
                Callers.hasClaim(jwt, "hrms.expense.reimbursement"),
                perm.check("hrms.expense.claim.approve"));
    }

    public Inbox inbox(String tab, int page, int size, Jwt jwt, Authentication auth) {
        String asked = tab == null || tab.isBlank() ? "all" : tab.trim().toLowerCase(java.util.Locale.ROOT);
        if (!InboxAccess.TAB_ORDER.contains(asked)) {
            throw new HrmsException("Choose one of: all, leave, attendance, requests, expenses.", HttpStatus.BAD_REQUEST,
                    "INBOX_TAB_INVALID");
        }
        if (page < 0) throw new HrmsException("The page can't be negative.", HttpStatus.BAD_REQUEST, "INBOX_PAGE_INVALID");
        int pageSize = size <= 0 ? DEFAULT_SIZE : Math.min(size, MAX_SIZE);

        InboxAccess a = access(jwt, auth);
        List<String> tabs = a.tabs();
        if (!tabs.contains(asked)) {
            throw new HrmsException("You can't see this list of approvals.", HttpStatus.FORBIDDEN, "INBOX_TAB_NOT_ALLOWED");
        }
        UUID tenantId = TenantContext.requireTenantId();
        LocalDate today = DateText.todayIst();
        Set<UUID> team = Callers.teamIds(teamScope, jwt);

        // Every row the caller may list, per kind (counts need them all).
        Map<DecisionKind, List<InboxQueries.Row>> byKind = new EnumMap<>(DecisionKind.class);
        List<String> unavailable = new ArrayList<>();
        for (DecisionKind kind : a.kinds("all")) {
            List<InboxQueries.Row> rows = read(kind, unavailable, () -> switch (kind) {
                case LEAVE -> queries.leave(tenantId, a);
                case WFH -> queries.wfh(tenantId, a);
                case CORRECTION -> queries.corrections(tenantId, a, team);
                case SHIFT_CHANGE -> queries.shiftChanges(tenantId, a, team, today);
                case EXPENSE -> queries.expenses(tenantId, a);
            });
            if (rows == null) continue;
            for (InboxQueries.Row r : rows) {
                r.canDecide = a.canDecide(kind, r.employeeId, (UUID) r.extra.get("approverId"), team);
            }
            byKind.put(kind, rows);
        }

        Map<String, Integer> counts = new LinkedHashMap<>();
        for (String t : InboxAccess.TAB_ORDER) counts.put(t, 0);
        byKind.forEach((kind, rows) -> {
            counts.merge(InboxAccess.tabOf(kind), rows.size(), Integer::sum);
            counts.merge("all", rows.size(), Integer::sum);
        });

        List<InboxQueries.Row> inTab = new ArrayList<>();
        for (DecisionKind kind : a.kinds(asked)) inTab.addAll(byKind.getOrDefault(kind, List.of()));
        inTab.sort(NEWEST_FIRST);
        int from = (int) Math.min((long) page * pageSize, inTab.size());
        List<InboxQueries.Row> pageRows = new ArrayList<>(inTab.subList(from, Math.min(from + pageSize, inTab.size())));

        enrich(tenantId, pageRows, a, team, today);

        List<DecisionJournal.Recent> recent;
        try {
            recent = undo.recentOrEmpty(jwt);
        } catch (RuntimeException e) {
            log.warn("Approvals inbox: recent decisions could not be read ({}); showing none", e.toString());
            recent = List.of();
        }
        return new Inbox(counts, tabs, pageRows, page, pageSize, inTab.size(), recent, unavailable);
    }

    static final Comparator<InboxQueries.Row> NEWEST_FIRST = Comparator
            .comparing((InboxQueries.Row r) -> r.createdAt == null ? Instant.EPOCH : r.createdAt).reversed()
            .thenComparing(r -> r.requestId.toString());

    private void enrich(UUID tenantId, List<InboxQueries.Row> rows, InboxAccess a, Set<UUID> team, LocalDate today) {
        Map<DecisionKind, List<InboxQueries.Row>> byKind = new EnumMap<>(DecisionKind.class);
        for (InboxQueries.Row r : rows) byKind.computeIfAbsent(r.decisionKind(), k -> new ArrayList<>()).add(r);
        // Colleagues' names are shown only when the caller sees them anyway: the whole tenant for
        // leave level 2, else their team.
        Set<UUID> visible = a.leaveL2() || a.workforceAdmin() ? null : team;
        byKind.forEach((kind, list) -> {
            try {
                readOnly.executeWithoutResult(s -> {
                    switch (kind) {
                        case LEAVE -> queries.enrichLeave(tenantId, list, visible);
                        case WFH -> queries.enrichWfh(tenantId, list, visible);
                        case CORRECTION -> queries.enrichCorrections(tenantId, list);
                        case SHIFT_CHANGE -> queries.enrichShiftChanges(tenantId, list, team, today);
                        case EXPENSE -> queries.enrichExpenses(tenantId, list);
                    }
                });
            } catch (RuntimeException e) {
                // Facts are extras: the rows still show, without them.
                log.warn("Approvals inbox: facts for {} could not be read ({})", kind, e.toString());
                list.forEach(r -> {
                    r.facts.clear();
                    r.warnings.clear();
                });
            }
        });
    }

    private List<InboxQueries.Row> read(DecisionKind kind, List<String> unavailable, Supplier<List<InboxQueries.Row>> source) {
        try {
            return readOnly.execute(s -> source.get());
        } catch (RuntimeException e) {
            log.warn("Approvals inbox: {} requests could not be read ({}); the rest still loads", kind, e.toString());
            unavailable.add(kind.name());
            return null;
        }
    }
}
