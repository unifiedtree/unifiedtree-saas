package com.unifiedtree.attendance.face.worker;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestTemplate;

import java.util.List;
import java.util.Map;

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
 */
@Component
public class FaceWorkerClient {

    private static final Logger log = LoggerFactory.getLogger(FaceWorkerClient.class);

    private final String workerUrl;
    private final RestTemplate http;

    public FaceWorkerClient(
            @Value("${unifiedtree.face.worker-url:http://localhost:8091}") String workerUrl,
            @Value("${unifiedtree.face.worker-timeout-ms:12000}") int timeoutMs,
            @Value("${unifiedtree.face.worker-connect-timeout-ms:12000}") int connectTimeoutMs) {
        this.workerUrl = workerUrl.replaceAll("/$", "");
        SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
        // Connect timeout MUST tolerate a scale-to-zero worker: Railway holds the
        // socket open while the container boots and lazy-loads its ONNX models.
        // The old Math.min(750, readTimeout) cap made a cold worker unreachable,
        // so the first punch after idle always 503'd. Both timeouts stay well
        // under the mobile checkin timeout (60s) so Spring returns a real verdict
        // before the app gives up with a bare "Network Error".
        factory.setConnectTimeout(connectTimeoutMs);
        factory.setReadTimeout(timeoutMs);
        this.http = new RestTemplate(factory);
    }

    public boolean isHealthy() {
        try {
            HttpHeaders h = jsonHeaders();
            ResponseEntity<Map> resp = http.exchange(
                    workerUrl + "/health", HttpMethod.GET,
                    new HttpEntity<>(h), Map.class);
            return resp.getStatusCode().is2xxSuccessful()
                    && "ok".equals(resp.getBody() == null ? null : resp.getBody().get("status"));
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
        try {
            HttpEntity<Object> entity = new HttpEntity<>(body, jsonHeaders());
            ResponseEntity<Map> resp = http.postForEntity(workerUrl + path, entity, Map.class);
            Map m = resp.getBody();
            if (m == null) {
                return WorkerResult.unavailable("worker returned empty body");
            }
            return WorkerResult.ok(m);
        } catch (ResourceAccessException ra) {
            log.warn("face worker {} unavailable: {}", path, ra.getMessage());
            return WorkerResult.unavailable("worker unreachable: " + ra.getMessage());
        } catch (Exception e) {
            log.warn("face worker {} call failed: {}", path, e.getMessage());
            return WorkerResult.unavailable("worker error: " + e.getMessage());
        }
    }

    private static HttpHeaders jsonHeaders() {
        HttpHeaders h = new HttpHeaders();
        h.setContentType(MediaType.APPLICATION_JSON);
        h.setAccept(List.of(MediaType.APPLICATION_JSON));
        return h;
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
