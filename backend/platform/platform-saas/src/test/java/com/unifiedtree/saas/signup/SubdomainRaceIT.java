package com.unifiedtree.saas.signup;

import org.junit.jupiter.api.Disabled;
import org.junit.jupiter.api.Test;

/**
 * B10 — Concurrent workspace creation with the same subdomain
 * (memory: synthetic-e2e-mandatory-for-payment — "subdomain-check-of-own-row"
 * was one of the 5 landmine bugs that only a real concurrent load caught).
 *
 * <p><b>Under test.</b> Two threads call
 * {@code POST /v1/accounts/workspaces} at the same time with the exact
 * same subdomain. Exactly ONE call must return 201 (the winner); the OTHER
 * must return 409 (subdomain reserved). Neither call may 500, and the
 * database MUST NOT end up with two tenant rows for the same subdomain
 * (the UNIQUE constraint on {@code platform.tenants(subdomain)} is the
 * last line of defence).
 *
 * <p>This is the race that the "check subdomain, then insert" pattern
 * loses if the check and the insert are not inside the same tx serialised
 * on the {@code subdomains} table. It bit us live during the fresh-launch
 * wipe QA pass.
 *
 * <p><b>Wiring notes for whoever enables this:</b>
 * <ul>
 *   <li>Boot via {@code hrms-app} test app (this module has no runnable
 *       Spring Boot main).</li>
 *   <li>Sign in twice with two separate accounts (JWTs) so
 *       {@link com.unifiedtree.saas.controller.AccountController#createWorkspace}
 *       is authenticated on both threads.</li>
 *   <li>Use a {@code CyclicBarrier(2)} so both HTTP POSTs are actually in
 *       flight simultaneously — no "the first request finished before the
 *       second even started" false negative.</li>
 *   <li>Assert exactly one 201 and one 409 (either ordering acceptable).
 *       Assert {@code SELECT count(*) FROM platform.tenants WHERE subdomain=?
 *       == 1} at the end.</li>
 * </ul>
 *
 * @see com.unifiedtree.saas.controller.AccountController#createWorkspace
 */
class SubdomainRaceIT {

    @Test
    @Disabled(
        "TODO(B10): needs Testcontainers Postgres + hrms-app Spring context "
        + "+ two authenticated JWTs + CyclicBarrier(2) to synchronise the "
        + "two concurrent POST /v1/accounts/workspaces calls.")
    void twoConcurrentCreateWorkspaceSameSubdomain_oneWinsOneReturns409() {
        // final String subdomain = "race-test-" + UUID.randomUUID().toString().substring(0, 8);
        // final CyclicBarrier gate = new CyclicBarrier(2);
        // Callable<Integer> post = () -> {
        //     gate.await();
        //     try {
        //         http().post().uri("/v1/accounts/workspaces")
        //             .header("Authorization", "Bearer " + jwt())
        //             .body(Map.of("subdomain", subdomain, "displayName", "Race"))
        //             .retrieve().toBodilessEntity();
        //         return 201;
        //     } catch (HttpClientErrorException e) {
        //         return e.getStatusCode().value();
        //     }
        // };
        // ExecutorService pool = Executors.newFixedThreadPool(2);
        // List<Future<Integer>> results = pool.invokeAll(List.of(post, post));
        // pool.shutdown();
        // List<Integer> codes = results.stream().map(f -> f.get()).sorted().toList();
        // assertThat(codes).containsExactly(201, 409);
        // Integer rows = jdbc.queryForObject(
        //     "SELECT count(*) FROM platform.tenants WHERE subdomain = ?",
        //     Integer.class, subdomain);
        // assertThat(rows).as("exactly one tenant row created").isEqualTo(1);
        throw new UnsupportedOperationException("skeleton — see @Disabled reason");
    }
}
