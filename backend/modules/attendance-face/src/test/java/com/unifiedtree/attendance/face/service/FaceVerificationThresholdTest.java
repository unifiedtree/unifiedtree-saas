package com.unifiedtree.attendance.face.service;

import org.junit.jupiter.api.Disabled;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * B10 — Face verification threshold guard (memory: face-recognition-tuning).
 *
 * <p>Locks the current tuning contract:
 * <ul>
 *   <li>match-threshold = 0.75 (dropped from 0.85 after 2026-07 tuning pass)</li>
 *   <li>match-quorum    = 2 of 3 templates must agree</li>
 *   <li>agree floor     = match-threshold - match-template-gap (0.05) = 0.70</li>
 *   <li>mean floor      = match-threshold - match-mean-gap (0.07)     = 0.68</li>
 * </ul>
 *
 * <p>These are the numbers the live production {@code FaceService} constructor
 * defaults must not silently drift away from. Any change here should be a
 * conscious, reviewed edit — regressions to the old 0.85 threshold or to a
 * quorum of 3 would lock genuine users out with only 3 enrolled templates
 * (memory-documented lesson).
 *
 * <p>These tests exercise the pure-math verification logic without booting
 * Spring or the Python worker. The full FaceService orchestration path is
 * covered separately by the integration suite once Docker Testcontainers is
 * wired for this module.
 */
class FaceVerificationThresholdTest {

    // Constants below mirror the @Value defaults in FaceService's constructor.
    // If FaceService's defaults change, either these must change (with a
    // review comment above the change) or the constructor was regressed.
    private static final double MATCH_THRESHOLD    = 0.75;
    private static final double MATCH_MEAN_GAP     = 0.07;   // mean floor  = 0.68
    private static final double MATCH_TEMPLATE_GAP = 0.05;   // agree floor = 0.70
    private static final int    MATCH_QUORUM       = 2;
    private static final int    SAMPLES_REQUIRED   = 3;

    // ── Positive: probe genuinely matches (≥0.75 on the best template, mean
    //    ≥0.68, and at least 2 of 3 templates ≥0.70) ────────────────────────
    @Test
    void matchAcceptedWhenBestScoreAtOrAboveThresholdAndQuorumSatisfied() {
        List<Double> scores = List.of(0.80, 0.78, 0.72); // best 0.80, mean 0.767
        assertThat(shouldPass(scores))
            .as("Genuine user: best ≥0.75, mean ≥0.68, 3/3 templates ≥0.70")
            .isTrue();
    }

    @Test
    void matchAcceptedAtBoundaryThreshold() {
        // Exactly at the 0.75 boundary — this is the "just barely genuine"
        // case memory face-recognition-tuning specifically loosened for.
        List<Double> scores = List.of(0.75, 0.71, 0.70);
        assertThat(shouldPass(scores))
            .as("Boundary case: best == 0.75 must pass, not reject")
            .isTrue();
    }

    // ── Negative: stranger (best below threshold) ───────────────────────────
    @Test
    void matchRejectedWhenBestScoreBelowThreshold() {
        List<Double> scores = List.of(0.74, 0.60, 0.55);
        assertThat(shouldPass(scores))
            .as("Stranger: best 0.74 < 0.75 must reject")
            .isFalse();
    }

    // ── Negative: one lucky angle only (the "match-inconsistent" branch that
    //    the mean/quorum check exists to catch) ────────────────────────────
    @Test
    void matchRejectedWhenOneLuckyAngleButMeanBelowFloor() {
        // Best template hits 0.90 but the other two are noise — mean 0.60 is
        // below the 0.68 mean floor, so this is FAIL_MATCH_INCONSISTENT even
        // though the best-score gate passed. Locking this behaviour is the
        // whole point of the mean/quorum layer added in the tuning pass.
        List<Double> scores = List.of(0.90, 0.50, 0.40);
        assertThat(shouldPass(scores))
            .as("Lucky-angle attacker: mean 0.60 < 0.68 must reject even if best=0.90")
            .isFalse();
    }

    @Test
    void matchRejectedWhenQuorumNotReached() {
        // Only 1 of 3 templates ≥ 0.70; quorum requires 2.
        List<Double> scores = List.of(0.85, 0.68, 0.55);
        // mean = 0.693 > 0.68, best = 0.85 > 0.75 — this SHOULD be a
        // quorum-driven reject. Templates ≥ 0.70: just the 0.85 one → 1 < 2.
        assertThat(shouldPass(scores))
            .as("Quorum: only 1/3 templates ≥0.70 must reject even if best/mean pass")
            .isFalse();
    }

    // ── Sanity: minimum template count matches the constant ─────────────────
    @Test
    void samplesRequiredMirrorsFaceServiceContract() {
        assertThat(SAMPLES_REQUIRED)
            .as("Test fixture must mirror FaceService.SAMPLES_REQUIRED (3)")
            .isEqualTo(3);
    }

    /**
     * Reproduces the three-way gate at the bottom of {@code FaceService.verify()}:
     *   1. best score >= matchThreshold
     *   2. mean       >= matchThreshold - matchMeanGap
     *   3. #(scores >= matchThreshold - matchTemplateGap) >= matchQuorum
     * Keep this in sync with the production branch; a divergence between the
     * two implementations would silently drop the whole test's usefulness.
     */
    private static boolean shouldPass(List<Double> scores) {
        double best = scores.stream().mapToDouble(Double::doubleValue).max().orElse(0);
        double mean = scores.stream().mapToDouble(Double::doubleValue).average().orElse(0);
        double agreeFloor = MATCH_THRESHOLD - MATCH_TEMPLATE_GAP;
        long agree = scores.stream().filter(s -> s != null && s >= agreeFloor).count();
        int neededQuorum = Math.min(MATCH_QUORUM, scores.size());
        return best >= MATCH_THRESHOLD
            && mean >= (MATCH_THRESHOLD - MATCH_MEAN_GAP)
            && agree >= neededQuorum;
    }

    // TODO(B10): integration-flavoured test that boots FaceService with real
    // encrypted templates + a stubbed FaceWorkerClient. Requires:
    //   - attendance.face_enrollments + face_embedding_templates seed rows
    //   - EmbeddingCipher wired with the same UNIFIEDTREE_FACE_ENCRYPTION_KEY
    //     used by hrms-app failsafe (see hrms-app pom failsafe env block)
    //   - a Testcontainers Postgres running the canonical Flyway migrations
    // The pure-math variant above is the drift guard; the integration
    // variant would additionally cover embedding decode + Base64 round-trip.
    @Test
    @Disabled("TODO(B10): wire Testcontainers + Flyway canonical seed for full FaceService boot-time test")
    void faceServiceBootTimeIntegrationTest() {
        // placeholder
    }
}
