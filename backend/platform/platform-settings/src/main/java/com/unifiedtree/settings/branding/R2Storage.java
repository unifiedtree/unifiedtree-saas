package com.unifiedtree.settings.branding;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.http.urlconnection.UrlConnectionHttpClient;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.S3Configuration;
import software.amazon.awssdk.services.s3.model.DeleteObjectRequest;
import software.amazon.awssdk.services.s3.model.PutObjectRequest;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;
import software.amazon.awssdk.services.s3.presigner.model.GetObjectPresignRequest;

import java.net.URI;
import java.time.Duration;
import java.util.Objects;

/**
 * Cloudflare R2 client — an S3-compatible bucket used for tenant uploads
 * (workspace logos today; more file categories later).
 *
 * <p>R2 uses region "auto"; AWS SDK v2 accepts that. Endpoint is per-account:
 * {@code https://<accountid>.r2.cloudflarestorage.com}. We use path-style
 * addressing because R2's bucket-subdomain form doesn't play nicely with
 * account-scoped credentials.
 *
 * <p>The bucket MAY have public-read enabled via the r2.dev subdomain, in
 * which case {@code publicBaseUrl} is set and {@link #urlFor(String)} returns
 * a stable URL. If it's not enabled, we fall back to 7-day presigned GETs
 * which work regardless of bucket policy — the SPA just needs to
 * treat the URL as opaque.
 */
@Component
public class R2Storage {

    private static final Logger log = LoggerFactory.getLogger(R2Storage.class);
    private static final Duration PRESIGNED_TTL = Duration.ofDays(7);

    private final String accountId;
    private final String bucket;
    private final String publicBaseUrl;   // e.g. https://pub-xxxx.r2.dev  (may be null)
    private final S3Client s3;
    private final S3Presigner presigner;
    private final boolean configured;

    public R2Storage(
            @Value("${unifiedtree.r2.account-id:${R2_ACCOUNT_ID:}}") String accountId,
            @Value("${unifiedtree.r2.bucket:${R2_BUCKET:unifiedtree-uploads}}") String bucket,
            @Value("${unifiedtree.r2.access-key-id:${R2_ACCESS_KEY_ID:}}") String accessKeyId,
            @Value("${unifiedtree.r2.secret-access-key:${R2_SECRET_ACCESS_KEY:}}") String secretAccessKey,
            @Value("${unifiedtree.r2.public-base-url:${R2_PUBLIC_BASE_URL:}}") String publicBaseUrl) {

        this.accountId = accountId == null ? "" : accountId.trim();
        this.bucket = bucket == null ? "" : bucket.trim();
        this.publicBaseUrl = (publicBaseUrl == null || publicBaseUrl.isBlank())
                ? null : publicBaseUrl.trim().replaceAll("/+$", "");

        // Configured iff we have all four required pieces. Local dev without R2
        // credentials degrades to a "storage disabled" state that BrandingService
        // detects and 503s — never a NullPointerException at request time.
        boolean ok = !this.accountId.isEmpty() && !this.bucket.isEmpty()
                && accessKeyId != null && !accessKeyId.isBlank()
                && secretAccessKey != null && !secretAccessKey.isBlank();
        this.configured = ok;

        if (ok) {
            URI endpoint = URI.create("https://" + this.accountId + ".r2.cloudflarestorage.com");
            StaticCredentialsProvider creds = StaticCredentialsProvider.create(
                    AwsBasicCredentials.create(accessKeyId, secretAccessKey));
            this.s3 = S3Client.builder()
                    .endpointOverride(endpoint)
                    .region(Region.of("auto"))
                    .credentialsProvider(creds)
                    .httpClient(UrlConnectionHttpClient.builder()
                            .connectionTimeout(Duration.ofSeconds(5))
                            .socketTimeout(Duration.ofSeconds(15))
                            .build())
                    .serviceConfiguration(S3Configuration.builder()
                            .pathStyleAccessEnabled(true)
                            .build())
                    .build();
            this.presigner = S3Presigner.builder()
                    .endpointOverride(endpoint)
                    .region(Region.of("auto"))
                    .credentialsProvider(creds)
                    .serviceConfiguration(S3Configuration.builder()
                            .pathStyleAccessEnabled(true)
                            .build())
                    .build();
            log.info("R2Storage ready: bucket={} publicBaseUrl={}", bucket,
                    this.publicBaseUrl == null ? "(none — presigning)" : this.publicBaseUrl);
        } else {
            this.s3 = null;
            this.presigner = null;
            log.warn("R2Storage NOT configured — set R2_ACCOUNT_ID + R2_BUCKET + R2_ACCESS_KEY_ID + R2_SECRET_ACCESS_KEY");
        }
    }

    public boolean isConfigured() { return configured; }

    /** Upload {@code bytes} at {@code key}. Content-type is what browsers use to render, so pass the sniffed one. */
    public void put(String key, byte[] bytes, String contentType) {
        require();
        s3.putObject(PutObjectRequest.builder()
                        .bucket(bucket).key(key).contentType(contentType).build(),
                RequestBody.fromBytes(bytes));
    }

    /** Best-effort delete — a stray old-logo file after re-upload is not worth failing the write on. */
    public void deleteQuietly(String key) {
        if (!configured || key == null || key.isBlank()) return;
        try {
            s3.deleteObject(DeleteObjectRequest.builder().bucket(bucket).key(key).build());
        } catch (Exception e) {
            log.warn("R2 delete failed for key={} — leaving as orphan: {}", key, e.getMessage());
        }
    }

    /**
     * Public URL for a stored object.
     * <p>If the bucket has public-read enabled and {@code publicBaseUrl} is
     * configured, returns a stable pub-*.r2.dev URL. Otherwise generates a
     * 7-day presigned GET — long enough that the SPA can cache it, short
     * enough that a leaked URL isn't a permanent leak.
     */
    public String urlFor(String key) {
        require();
        Objects.requireNonNull(key, "key");
        if (publicBaseUrl != null) {
            return publicBaseUrl + "/" + key;
        }
        return presigner.presignGetObject(GetObjectPresignRequest.builder()
                        .signatureDuration(PRESIGNED_TTL)
                        .getObjectRequest(r -> r.bucket(bucket).key(key))
                        .build())
                .url()
                .toString();
    }

    private void require() {
        if (!configured) {
            throw new IllegalStateException("R2 storage is not configured on this instance");
        }
    }
}
