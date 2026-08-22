package com.unifiedtree.attendance.face.worker;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.client.WebClient;
import org.springframework.web.reactive.function.client.WebClientRequestException;
import org.springframework.web.reactive.function.client.WebClientResponseException;

import io.netty.channel.ChannelOption;
import reactor.netty.http.client.HttpClient;
import org.springframework.http.client.reactive.ReactorClientHttpConnector;

import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;

/**
 * HTTP client for the self-hosted Python face-verification worker.
 *
 * <p>Spring is the source of truth for tenants, employees, RBAC, audit
 * trail, and the encrypted embedding store. The worker is a stateless
 * compute service: take an image, return a verdict (face_detected,
 * embedding vector, quality score, liveness score, spoof risk, optional
 * match_score against a candidate embedding).
 *
 * <p>FAIL CLOSED: if the worker is unreachable or times out, every
 * caller path translates that into a {@code FAIL_WORKER_UNAVAILABLE}
 * audit event and a 503 to the client. A working face system NEVER lets
 * an attendance punch-in succeed without a real worker verdict.
 *
 * <p><b>B7 rewrite (2026-08-14):</b>
 * <ul>
 *   <li>Switched from RestTemplate to WebClient (reactor-netty), matching
 *       {@code FaceRecognitionClient}. One reactive stack instead of two.</li>
 *   <li>Wrapped every call in a plain-JDK {@link Semaphore} bulkhead
 *       (Resilience4j is only in the app-runner classpath, not this
 *       module's, so we use the java.util.concurrent primitive to stay
 *       dependency-neutral). A burst of face requests can no longer drain
 *       the Tomcat thread pool: excess callers wait a bounded time for a
 *       permit, then fail closed with {@code worker_bulkhead_saturated}.</li>
 * </ul>
 */
@Component
public class FaceWorkerClient {

    private static final Logger log = LoggerFactory.getLogger(FaceWorkerClient.class);

    private final String workerUrl;
    private final Duration readTimeout;
    private final WebClient http;
    private final Semaphore bulkhead;
    private final long bulkheadWaitMs;

    public FaceWorkerClient(
            @Value("${unifiedtree.face.worker-url:http://localhost:8091}") String workerUrl,
            @Value("${unifiedtree.face.worker-timeout-ms:12000}") int timeoutMs,
            @Value("${unifiedtree.face.worker-connect-timeout-ms:12000}") int connectTimeoutMs,
            // Bulkhead sizing: the worker itself is single-CPU-bound (ONNX
            // inference) — allowing ~16 concurrent requests keeps it busy
            // without inviting queueing storms upstream. Overridable at
            // deploy time if you scale the worker horizontally.
            @Value("${unifiedtree.face.worker-max-concurrent:16}") int maxConcurrent,
            // Wait budget before a saturated bulkhead rejects the caller.
            // Kept small so a slow worker doesn't tie up Tomcat threads
            // just standing in line — fail fast, let the client retry.
            @Value("${unifiedtree.face.worker-bulkhead-wait-ms:500}") long bulkheadWaitMs) {
        this.workerUrl = workerUrl.replaceAll("/$", "");
        // Connect timeout MUST tolerate a cold worker: Cloud Run holds the socket
        // open while the container boots and loads its ONNX models. The old
        // Math.min(750, readTimeout) cap made a cold worker unreachable, so the
        // first punch after idle always 503'd.
        //
        // These two apply SERIALLY (connect, then response), so the worst case
        // Spring can spend here is connectTimeoutMs + timeoutMs = 24s at the
        // 12000/12000 defaults. That MUST stay below the mobile client's
        // FACE_TIMEOUT (30s, Attendance_App/services/api/face.api.ts) so Spring
        // returns a real verdict — FAIL_MATCH, FAIL_LOW_QUALITY, a 402 — before
        // the app gives up with a bare "Network Error". Raising either value
        // without raising FACE_TIMEOUT first inverts that and degrades every
        // genuine rejection into a generic connectivity error.
        this.readTimeout = Duration.ofMillis(timeoutMs);
        HttpClient httpClient = HttpClient.create()
                .option(ChannelOption.CONNECT_TIMEOUT_MILLIS, connectTimeoutMs)
                .responseTimeout(readTimeout);
        this.http = WebClient.builder()
                .baseUrl(this.workerUrl)
                .clientConnector(new ReactorClientHttpConnector(httpClient))
                .build();
        this.bulkhead = new Semaphore(Math.max(1, maxConcurrent), /*fair*/ true);
        this.bulkheadWaitMs = Math.max(0, bulkheadWaitMs);
    }

    public boolean isHealthy() {
        try {
            @SuppressWarnings("rawtypes")
            Map body = http.get().uri("/health")
                    .headers(this::applyAuthHeaders)
                    .retrieve()
                    .bodyToMono(Map.class)
                    .block(readTimeout);
            return body != null && "ok".equals(body.get("status"));
        } catch (Exception e) {
            log.warn("face worker /health failed: {}", e.getMessage());
            return false;
        }
    }

    /** POST /face/quality - returns face_detected + quality_score + landmarks. */
    public WorkerResult assessSample(SampleRequest req) {
        return call("/face/enroll/sample", req);
    }

    /** POST /face/verify - returns match_score against the supplied template list. */
    public WorkerResult verify(VerifyRequest req) {
        return call("/face/verify", req);
    }

    private WorkerResult call(String path, Object body) {
        // Bulkhead — bounded wait for a permit, then fail closed. This is
        // the fix for a face-worker slowdown draining the Tomcat thread
        // pool: without it, every Tomcat thread blocks on .block() and
        // the whole API stops answering. With it, at most maxConcurrent
        // requests are in-flight; the rest either get a permit within
        // bulkheadWaitMs or return a 503-shaped result immediately.
        boolean acquired = false;
        try {
            acquired = bulkhead.tryAcquire(bulkheadWaitMs, TimeUnit.MILLISECONDS);
            if (!acquired) {
                log.warn("face worker bulkhead saturated (max={} in-flight); rejecting {}",
                        bulkhead.availablePermits(), path);
                return WorkerResult.unavailable("worker_bulkhead_saturated");
            }
        } catch (InterruptedException ie) {
            Thread.currentThread().interrupt();
            return WorkerResult.unavailable("interrupted waiting for face worker bulkhead");
        }
        try {
            @SuppressWarnings("rawtypes")
            Map m = http.post().uri(path)
                    .contentType(MediaType.APPLICATION_JSON)
                    .accept(MediaType.APPLICATION_JSON)
                    .headers(this::applyAuthHeaders)
                    .bodyValue(body)
                    .retrieve()
                    .bodyToMono(Map.class)
                    .block(readTimeout);
            if (m == null) {
                return WorkerResult.unavailable("worker returned empty body");
            }
            @SuppressWarnings("unchecked")
            Map<String, Object> typed = (Map<String, Object>) m;
            return WorkerResult.ok(typed);
        } catch (WebClientRequestException ra) {
            // Connect/read timeout or DNS failure — behaves like the old
            // ResourceAccessException path.
            log.warn("face worker {} unavailable: {}", path, ra.getMessage());
            return WorkerResult.unavailable("worker unreachable: " + ra.getMessage());
        } catch (WebClientResponseException re) {
            log.warn("face worker {} returned {}: {}", path, re.getStatusCode(), re.getMessage());
            return WorkerResult.unavailable("worker error: " + re.getStatusCode());
        } catch (Exception e) {
            log.warn("face worker {} call failed: {}", path, e.getMessage());
            return WorkerResult.unavailable("worker error: " + e.getMessage());
        } finally {
            bulkhead.release();
        }
    }

    private void applyAuthHeaders(HttpHeaders h) {
        String bearer = fetchIdToken();
        if (bearer != null) h.setBearerAuth(bearer);
    }

    /**
     * Fetch a Google-issued ID token for the face worker's URL from the Cloud
     * Run metadata server. The token proves this service's identity so the
     * face worker (locked to internal callers) can verify us and refuse the
     * open internet.
     *
     * <p>Cached for its full lifetime minus 5 minutes so hot request paths
     * do not hit the metadata server on every call; the metadata call is
     * cheap but not free, and Google recommends caching. Returns null when
     * the metadata server is unreachable (local dev, non-GCP runtime) so
     * the client still works there against a local face worker.
     */
    private volatile String cachedIdToken;
    private volatile long cachedIdTokenExpiresAtMillis;

    private String fetchIdToken() {
        long now = System.currentTimeMillis();
        if (cachedIdToken != null && now < cachedIdTokenExpiresAtMillis) {
            return cachedIdToken;
        }
        try {
            // Cloud Run + Compute Engine metadata endpoint. Audience = the
            // exact base URL of the receiving service (no trailing slash).
            java.net.URL url = new java.net.URL(
                    "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity"
                    + "?audience=" + java.net.URLEncoder.encode(workerUrl, java.nio.charset.StandardCharsets.UTF_8));
            java.net.HttpURLConnection conn = (java.net.HttpURLConnection) url.openConnection();
            conn.setRequestProperty("Metadata-Flavor", "Google");
            conn.setConnectTimeout(1500);
            conn.setReadTimeout(1500);
            if (conn.getResponseCode() != 200) return null;
            String token;
            try (java.io.BufferedReader r = new java.io.BufferedReader(
                    new java.io.InputStreamReader(conn.getInputStream(), java.nio.charset.StandardCharsets.UTF_8))) {
                token = r.readLine();
            }
            if (token == null || token.isBlank()) return null;
            cachedIdToken = token.trim();
            // ID tokens are valid 1 hour. Cache for 55 minutes.
            cachedIdTokenExpiresAtMillis = now + 55 * 60 * 1000L;
            return cachedIdToken;
        } catch (Exception e) {
            // Local dev or a metadata-less runtime: fall back to no auth so
            // the client still works against a self-hosted worker (this is
            // exactly the failure mode DevOps expects on their laptop). The
            // production face worker's IAM check will still refuse an
            // unauthenticated caller — so no security regression.
            return null;
        }
    }

    /** Body for /face/enroll/sample. */
    public record SampleRequest(
            String imageBase64,
            String captureAngle,
            String challenge
    ) {}

    /** Body for /face/verify. Candidate is the enrolled employee's templates. */
    public record VerifyRequest(
            String imageBase64,
            String challenge,
            /** Base64 of the previously-stored embeddings as plain float32-LE.
             *  The worker compares the live face against ALL provided
             *  candidates and returns the best score. */
            List<String> candidateEmbeddingsBase64,
            int embeddingDim,
            String modelName,
            String modelVersion
    ) {}

    /** Generic outcome from the worker. */
    public record WorkerResult(boolean ok, String error, Map<String, Object> body) {
        public static WorkerResult ok(Map<String, Object> body) { return new WorkerResult(true, null, body); }
        public static WorkerResult unavailable(String error) { return new WorkerResult(false, error, Map.of()); }

        public Object get(String key) { return body == null ? null : body.get(key); }

        public Double doubleField(String key) {
            Object v = get(key);
            if (v instanceof Number n) return n.doubleValue();
            return null;
        }

        public Boolean boolField(String key) {
            Object v = get(key);
            return v instanceof Boolean b ? b : null;
        }

        public String stringField(String key) {
            Object v = get(key);
            return v == null ? null : v.toString();
        }

        /** Returns the per-template score list returned by /face/verify, or
         *  an empty list if the worker did not surface it (older worker /
         *  smoke fixtures). Numeric coercion is permissive: Double, Float,
         *  Integer all coerce to double. */
        public java.util.List<Double> doubleList(String key) {
            Object v = get(key);
            if (!(v instanceof java.util.List<?> raw)) {
                return java.util.List.of();
            }
            java.util.List<Double> out = new java.util.ArrayList<>(raw.size());
            for (Object x : raw) {
                if (x instanceof Number n) out.add(n.doubleValue());
            }
            return out;
        }
    }
}
