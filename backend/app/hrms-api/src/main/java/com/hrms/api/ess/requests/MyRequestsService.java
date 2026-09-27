package com.hrms.api.ess.requests;

import com.hrms.api.ess.EssCaller;
import com.hrms.api.ess.EssSourceRunner;
import com.hrms.api.ess.EssSourceRunner.Collected;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.Comparator;
import java.util.List;

/**
 * Home's "My requests" (BW-119): one list across leave, work from home,
 * attendance fixes, shift changes, expense claims and salary advances.
 *
 * <p>Each kind is read only when the caller holds the permission of its own
 * list endpoint and its module is on; a kind that fails is named in
 * {@code unavailable} and the others still answer ({@link EssSourceRunner}).
 * Waiting requests come first (newest first), then the rest by their latest
 * change.
 */
@Service
public class MyRequestsService {

    public static final int DEFAULT_LIMIT = 6;
    public static final int MAX_LIMIT = 20;

    private final List<MyRequestSource> sources;
    private final EssSourceRunner runner;

    public MyRequestsService(List<MyRequestSource> sources, EssSourceRunner runner) {
        this.sources = List.copyOf(sources);
        this.runner = runner;
    }

    public MyRequest.Response myRequests(EssCaller caller, Integer requestedLimit) {
        int limit = requestedLimit == null ? DEFAULT_LIMIT : Math.max(1, Math.min(requestedLimit, MAX_LIMIT));
        Collected<MyRequest> got = runner.collect(caller, sources, true, s -> s.load(caller, limit));
        List<MyRequest> rows = got.items().stream().sorted(ORDER).limit(limit).toList();
        return new MyRequest.Response(rows, got.included(), got.unavailable());
    }

    /** Waiting first; within each group the newest (waiting: sent; others: latest change) first. */
    static final Comparator<MyRequest> ORDER = Comparator
            .comparing((MyRequest r) -> !"WAITING".equals(r.state()))
            .thenComparing((MyRequest r) -> "WAITING".equals(r.state()) ? r.createdAt() : r.lastActivityAt(),
                    Comparator.nullsLast(Comparator.<Instant>reverseOrder()))
            .thenComparing(r -> r.id().toString());
}
