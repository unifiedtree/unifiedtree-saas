package com.hrms.api.ess.requests;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

/** Builds a request's steps and its progress (the share of steps done). */
final class Steps {

    static final String DONE = "DONE";
    static final String CURRENT = "CURRENT";
    static final String TODO = "TODO";
    static final String SKIPPED = "SKIPPED";

    private final List<MyRequest.Step> steps = new ArrayList<>();

    Steps done(String label, String person, Instant at) {
        steps.add(new MyRequest.Step(label, DONE, person, at));
        return this;
    }

    Steps current(String label, String person) {
        steps.add(new MyRequest.Step(label, CURRENT, person, null));
        return this;
    }

    Steps todo(String label) {
        steps.add(new MyRequest.Step(label, TODO, null, null));
        return this;
    }

    Steps skipped(String label) {
        steps.add(new MyRequest.Step(label, SKIPPED, null, null));
        return this;
    }

    List<MyRequest.Step> list() {
        return List.copyOf(steps);
    }

    /** 100 once the request is closed (approved and done, rejected or cancelled); else the share of steps done. */
    int progress(boolean closed) {
        if (closed || steps.isEmpty()) return closed ? 100 : 0;
        long done = steps.stream().filter(s -> DONE.equals(s.state())).count();
        return (int) Math.round(100.0 * done / steps.size());
    }
}
