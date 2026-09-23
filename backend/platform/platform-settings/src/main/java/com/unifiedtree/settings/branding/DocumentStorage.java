package com.unifiedtree.settings.branding;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/** Employee documents use a separately configured private bucket, never the public branding bucket. */
@Component
public class DocumentStorage {
    private final R2Storage storage;

    public DocumentStorage(
            @Value("${unifiedtree.r2.account-id:${R2_ACCOUNT_ID:}}") String accountId,
            @Value("${unifiedtree.r2.document-bucket:${R2_DOCUMENT_BUCKET:}}") String bucket,
            @Value("${unifiedtree.r2.access-key-id:${R2_ACCESS_KEY_ID:}}") String accessKey,
            @Value("${unifiedtree.r2.secret-access-key:${R2_SECRET_ACCESS_KEY:}}") String secretKey) {
        storage = new R2Storage(accountId, bucket, accessKey, secretKey, "");
    }

    public boolean isConfigured() { return storage.isConfigured(); }
    public void put(String key, byte[] bytes, String contentType) { storage.put(key, bytes, contentType); }
    public String urlFor(String key) { return storage.urlFor(key); }
    public void deleteQuietly(String key) { storage.deleteQuietly(key); }
}
