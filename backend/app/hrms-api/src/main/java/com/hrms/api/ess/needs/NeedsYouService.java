package com.hrms.api.ess.needs;

import com.hrms.api.ess.EssCaller;
import com.hrms.api.ess.EssSourceRunner;
import com.hrms.api.ess.EssSourceRunner.Collected;
import org.springframework.stereotype.Service;

import java.util.Comparator;
import java.util.List;

/**
 * Home's "Needs you" (BW-120): the things only this person can do, from the
 * tables that exist today. Missed punch-outs with no fix, documents to upload
 * again or still missing, my onboarding tasks, interview scorecards, my
 * self-review, reviews I have to write, policies to accept, and (for managers
 * who may decide it) their team's probation; and, now that their tables exist,
 * assets to confirm and timesheet weeks sent back.
 *
 * <p>Each source sits behind the permission of the page it links to and runs on
 * its own ({@link EssSourceRunner}); a failing one is named in
 * {@code unavailable}. Letters to sign and the review and policy deadlines are
 * added as sources once those packages' tables exist.
 * Red items come first, then gold, blue and brand; within a colour, the
 * soonest due.
 */
@Service
public class NeedsYouService {

    static final List<String> TONE_ORDER = List.of(NeedsYouItem.BAD, NeedsYouItem.GOLD, NeedsYouItem.BLUE, NeedsYouItem.BRAND);

    private final List<NeedsYouSource> sources;
    private final EssSourceRunner runner;

    public NeedsYouService(List<NeedsYouSource> sources, EssSourceRunner runner) {
        this.sources = List.copyOf(sources);
        this.runner = runner;
    }

    public NeedsYouItem.Response needsYou(EssCaller caller) {
        Collected<NeedsYouItem> got = runner.collect(caller, sources, true, s -> s.load(caller));
        List<NeedsYouItem> items = got.items().stream().sorted(ORDER).toList();
        int count = items.stream().mapToInt(i -> Math.max(1, i.count())).sum();
        return new NeedsYouItem.Response(items, count, got.included(), got.unavailable());
    }

    static final Comparator<NeedsYouItem> ORDER = Comparator
            .comparing((NeedsYouItem i) -> {
                int r = TONE_ORDER.indexOf(i.tone());
                return r < 0 ? TONE_ORDER.size() : r;
            })
            .thenComparing(NeedsYouItem::dueDate, Comparator.nullsLast(Comparator.naturalOrder()));
}
