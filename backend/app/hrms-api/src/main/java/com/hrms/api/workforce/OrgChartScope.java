package com.hrms.api.workforce;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.Deque;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * Who appears on the org chart, and under whom (client ask, 1 Oct 2026: a
 * Keka-style tree from the top person down, by reporting line). Pure: no
 * database, so every rule is unit-tested on its own.
 *
 * <p>The tree follows the stored reporting manager. Two views:
 * <ul>
 *   <li>{@link #company}: everyone active in one company (people with
 *       hrms.employee.read);</li>
 *   <li>{@link #team}: the viewer's chain upward to the top, the viewer, and
 *       everyone below them (everyone else). Nobody beside or outside that line.</li>
 * </ul>
 * Data mistakes never hide anyone or loop: a person whose manager isn't on the
 * chart (left, in another company, missing) hangs at the top level with
 * {@link Note#MANAGER_NOT_SHOWN}; a reporting loop (A reports to B, B to A) is
 * cut at one person, who hangs at the top level with {@link Note#CYCLE}.
 */
final class OrgChartScope {

    private OrgChartScope() {
    }

    /** One active person: who they report to (as stored; may be anyone, or nobody) and their company. */
    record Link(UUID id, UUID managerId, UUID companyId, String name) {
    }

    /** How a person on the team view relates to the viewer. */
    enum Relation { SELF, ABOVE, BELOW }

    /** Why a person sits at the top level although a manager is stored for them. */
    enum Note { MANAGER_NOT_SHOWN, CYCLE }

    /** A person on the chart, drawn under {@code parentId} (null: top level). */
    record Placed(UUID id, UUID parentId, Relation relation, Note note) {
    }

    /** The people on the chart, parents before their reports, and whether a size limit cut it short. */
    record Result(List<Placed> people, boolean truncated) {
    }

    /** Most levels followed above the viewer: a safety stop for broken data. */
    static final int MAX_CHAIN = 64;
    /** Most people on one chart. Beyond it the chart says it was cut short. */
    static final int MAX_PEOPLE = 10_000;

    /** Name order (then id, so equal names stay in a fixed order). */
    static final Comparator<Link> BY_NAME = Comparator
            .comparing((Link l) -> l.name() == null ? "" : l.name().toLowerCase(java.util.Locale.ROOT))
            .thenComparing(l -> l.id().toString());

    /** The active direct reports of each person, as stored, whoever can see them. */
    static Map<UUID, Integer> directReportCounts(Collection<Link> people) {
        Map<UUID, Integer> n = new HashMap<>();
        for (Link l : people) {
            if (l.managerId() != null && !l.managerId().equals(l.id())) n.merge(l.managerId(), 1, Integer::sum);
        }
        return n;
    }

    /**
     * Company view: everyone active in {@code companyId}. A manager outside the
     * company's active people puts the person at the top level; a loop is cut at
     * its first person by name.
     */
    static Result company(Collection<Link> people, UUID companyId) {
        Map<UUID, Link> byId = new HashMap<>();
        for (Link l : people) {
            if (companyId != null && companyId.equals(l.companyId())) byId.put(l.id(), l);
        }
        Map<UUID, UUID> parent = new HashMap<>();
        Map<UUID, Note> note = new HashMap<>();
        for (Link l : byId.values()) {
            UUID m = l.managerId();
            if (m == null) continue;
            if (m.equals(l.id())) note.put(l.id(), Note.CYCLE);                 // reports to themself
            else if (byId.containsKey(m)) parent.put(l.id(), m);
            else note.put(l.id(), Note.MANAGER_NOT_SHOWN);                      // left, another company, or gone
        }

        Map<UUID, List<Link>> children = childrenOf(byId.values(), parent);
        List<Link> sorted = new ArrayList<>(byId.values());
        sorted.sort(BY_NAME);

        List<Placed> out = new ArrayList<>(byId.size());
        Set<UUID> reached = new HashSet<>();
        for (Link l : sorted) {
            if (!parent.containsKey(l.id())) walk(l.id(), null, note.get(l.id()), children, reached, out);
        }
        // Whoever is still unreached sits in or under a reporting loop: cut each loop once.
        for (Link l : sorted) {
            if (reached.contains(l.id())) continue;
            UUID cut = loopMember(l.id(), parent, byId);
            UUID was = parent.remove(cut);
            if (was != null) children.getOrDefault(was, new ArrayList<>()).removeIf(c -> c.id().equals(cut));
            note.put(cut, Note.CYCLE);
            walk(cut, null, Note.CYCLE, children, reached, out);
        }
        if (out.size() > MAX_PEOPLE) return new Result(List.copyOf(out.subList(0, MAX_PEOPLE)), true);
        return new Result(out, false);
    }

    /**
     * Team view: the viewer, everyone above them up to the top, and everyone
     * below them. Empty when the viewer isn't an active employee (no employee
     * record, or not active).
     */
    static Result team(Collection<Link> people, UUID viewer) {
        Map<UUID, Link> byId = new HashMap<>();
        for (Link l : people) byId.put(l.id(), l);
        if (viewer == null || !byId.containsKey(viewer)) return new Result(List.of(), false);

        // Up: manager by manager, until nobody, someone not active, or someone already on the chart (a loop).
        Set<UUID> on = new HashSet<>();
        on.add(viewer);
        List<UUID> up = new ArrayList<>();
        UUID m = byId.get(viewer).managerId();
        while (m != null && byId.containsKey(m) && !on.contains(m) && up.size() < MAX_CHAIN) {
            on.add(m);
            up.add(m);
            m = byId.get(m).managerId();
        }
        UUID top = up.isEmpty() ? viewer : up.get(up.size() - 1);
        Note topNote = m == null ? null : on.contains(m) ? Note.CYCLE : Note.MANAGER_NOT_SHOWN;

        List<Placed> out = new ArrayList<>();
        for (int i = up.size() - 1; i >= 0; i--) {
            UUID id = up.get(i);
            out.add(new Placed(id, i == up.size() - 1 ? null : up.get(i + 1), Relation.ABOVE, id.equals(top) ? topNote : null));
        }
        out.add(new Placed(viewer, up.isEmpty() ? null : up.get(0), Relation.SELF, viewer.equals(top) ? topNote : null));

        // Down: everyone under the viewer, level by level; someone already on the chart is not drawn twice.
        Map<UUID, List<Link>> reports = new HashMap<>();
        for (Link l : byId.values()) {
            if (l.managerId() != null && !l.managerId().equals(l.id())) reports.computeIfAbsent(l.managerId(), k -> new ArrayList<>()).add(l);
        }
        reports.values().forEach(list -> list.sort(BY_NAME));
        Deque<UUID> queue = new ArrayDeque<>();
        queue.add(viewer);
        boolean truncated = false;
        while (!queue.isEmpty() && !truncated) {
            UUID p = queue.poll();
            for (Link c : reports.getOrDefault(p, List.of())) {
                if (!on.add(c.id())) continue;
                if (out.size() >= MAX_PEOPLE) { truncated = true; break; }
                out.add(new Placed(c.id(), p, Relation.BELOW, null));
                queue.add(c.id());
            }
        }
        return new Result(out, truncated);
    }

    /** Reports of each person on the chart, in name order. */
    private static Map<UUID, List<Link>> childrenOf(Collection<Link> people, Map<UUID, UUID> parent) {
        Map<UUID, List<Link>> children = new HashMap<>();
        for (Link l : people) {
            UUID p = parent.get(l.id());
            if (p != null) children.computeIfAbsent(p, k -> new ArrayList<>()).add(l);
        }
        children.values().forEach(list -> list.sort(BY_NAME));
        return children;
    }

    /** Adds {@code root} and everyone under it (depth first, name order), each once. */
    private static void walk(UUID root, UUID rootParent, Note rootNote, Map<UUID, List<Link>> children,
                             Set<UUID> reached, List<Placed> out) {
        if (!reached.add(root)) return;
        out.add(new Placed(root, rootParent, null, rootNote));
        Deque<UUID> stack = new ArrayDeque<>();
        stack.push(root);
        // Iterative pre-order: a deep chain can't overflow the stack.
        Deque<java.util.Iterator<Link>> its = new ArrayDeque<>();
        its.push(children.getOrDefault(root, List.of()).iterator());
        while (!its.isEmpty()) {
            java.util.Iterator<Link> it = its.peek();
            if (!it.hasNext()) { its.pop(); stack.pop(); continue; }
            Link c = it.next();
            if (!reached.add(c.id())) continue;
            out.add(new Placed(c.id(), stack.peek(), null, null));
            stack.push(c.id());
            its.push(children.getOrDefault(c.id(), List.of()).iterator());
        }
    }

    /**
     * A person on the reporting loop above {@code start} (which is unreachable
     * from the top, so following managers from it must come back round): the
     * loop member first by name.
     */
    private static UUID loopMember(UUID start, Map<UUID, UUID> parent, Map<UUID, Link> byId) {
        Set<UUID> seen = new LinkedHashSet<>();
        UUID x = start;
        while (x != null && seen.add(x)) x = parent.get(x);
        if (x == null) return start;   // not a loop after all: cut where we started
        List<Link> loop = new ArrayList<>();
        UUID y = x;
        do {
            loop.add(byId.get(y));
            y = parent.get(y);
        } while (y != null && !y.equals(x));
        loop.sort(BY_NAME);
        return loop.get(0).id();
    }
}
