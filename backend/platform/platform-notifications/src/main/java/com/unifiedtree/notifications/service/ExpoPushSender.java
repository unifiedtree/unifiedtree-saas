package com.unifiedtree.notifications.service;

import com.unifiedtree.notifications.entity.DeviceToken;
import com.unifiedtree.notifications.repository.DeviceTokenRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.task.TaskExecutor;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.web.client.RestTemplate;

import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Fire-and-forget Expo push sender.
 *
 * <p>Contract: the send is scheduled to run AFTER the current DB transaction
 * commits, and always on the {@code notificationExecutor} pool — never on the
 * request thread. A slow or failing Expo endpoint cannot block or fail the
 * user's HTTP request.
 *
 * <p>Handles the Expo ticket response: tokens that Expo reports as
 * {@code DeviceNotRegistered} are flipped {@code is_active = false} so we
 * stop spamming dead tokens on future events.
 */
@Service
public class ExpoPushSender {

    private static final Logger log = LoggerFactory.getLogger(ExpoPushSender.class);

    private final DeviceTokenRepository tokenRepo;
    private final RestTemplate rest;
    private final TaskExecutor executor;
    private final String expoUrl;
    private final boolean enabled;

    public ExpoPushSender(DeviceTokenRepository tokenRepo,
                          @Qualifier("expoPushRestTemplate") RestTemplate rest,
                          @Qualifier("notificationExecutor") TaskExecutor executor,
                          @Value("${unifiedtree.push.expo.url:https://exp.host/--/api/v2/push/send}") String expoUrl,
                          @Value("${unifiedtree.push.expo.enabled:true}") boolean enabled) {
        this.tokenRepo = tokenRepo;
        this.rest = rest;
        this.executor = executor;
        this.expoUrl = expoUrl;
        this.enabled = enabled;
    }

    /**
     * Schedule an Expo push for after the current DB transaction commits.
     * Safe to call from any transactional context; if there is no active tx
     * the send is dispatched immediately to the executor (still async).
     *
     * <p>NEVER call this on the request thread synchronously — it would
     * negate the request-latency guarantees documented in
     * {@link com.unifiedtree.notifications.config.NotificationsAsyncConfig}.
     */
    public void sendAfterCommit(UUID userId, String title, String body, Map<String, Object> data) {
        if (!enabled) return;
        Runnable task = () -> executor.execute(() -> deliver(userId, title, body, data));
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override public void afterCommit() { task.run(); }
            });
        } else {
            // No tx — dispatch immediately to the executor (still async).
            task.run();
        }
    }

    /** Package-private for testing. */
    void deliver(UUID userId, String title, String body, Map<String, Object> data) {
        try {
            List<DeviceToken> tokens = tokenRepo.findByUserIdAndActiveTrue(userId);
            if (tokens.isEmpty()) {
                log.debug("no active device tokens for user={}, skipping push", userId);
                return;
            }
            List<Map<String, Object>> messages = new ArrayList<>(tokens.size());
            for (DeviceToken t : tokens) {
                Map<String, Object> msg = new HashMap<>();
                msg.put("to", t.getExpoPushToken());
                msg.put("title", title);
                msg.put("body", body == null ? "" : body);
                msg.put("sound", "default");
                msg.put("priority", "high");
                msg.put("channelId", "default");
                msg.put("data", data == null ? Map.of() : data);
                messages.add(msg);
            }

            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_JSON);
            headers.set(HttpHeaders.ACCEPT, "application/json");
            headers.set(HttpHeaders.ACCEPT_ENCODING, "gzip, deflate");

            ResponseEntity<Map> resp = rest.postForEntity(
                    expoUrl, new HttpEntity<>(messages, headers), Map.class);
            handleTickets(tokens, resp.getBody());

            // Bump last_used_at so we can garbage-collect ancient tokens later.
            Instant now = Instant.now();
            for (DeviceToken t : tokens) {
                t.setLastUsedAt(now);
            }
            tokenRepo.saveAll(tokens);
        } catch (Exception e) {
            // Push failures never surface to the caller — they already got their
            // in-app notification row. Log for observability only.
            log.warn("Expo push failed for user {}: {}", userId, e.getMessage());
        }
    }

    /**
     * Expo returns a {@code data} array of tickets in the same order as the
     * request messages. A ticket with {@code status:"error"} and
     * {@code details.error:"DeviceNotRegistered"} means the token is dead —
     * OS uninstall, token rotation, etc. Deactivate it so we don't spam it
     * on the next event.
     */
    @SuppressWarnings("unchecked")
    void handleTickets(List<DeviceToken> tokens, Map<?, ?> body) {
        if (body == null) return;
        Object dataObj = body.get("data");
        if (!(dataObj instanceof List<?> list)) return;
        List<DeviceToken> toDeactivate = new ArrayList<>();
        for (int i = 0; i < list.size() && i < tokens.size(); i++) {
            Object entry = list.get(i);
            if (!(entry instanceof Map<?, ?> ticket)) continue;
            Object status = ticket.get("status");
            if (!"error".equals(status)) continue;
            Object details = ticket.get("details");
            String detailErr = null;
            if (details instanceof Map<?, ?> dm) {
                Object e = dm.get("error");
                if (e != null) detailErr = e.toString();
            }
            if ("DeviceNotRegistered".equals(detailErr)) {
                DeviceToken t = tokens.get(i);
                t.setActive(false);
                toDeactivate.add(t);
                log.info("Deactivating dead Expo token for user={}", t.getUserId());
            }
        }
        if (!toDeactivate.isEmpty()) tokenRepo.saveAll(toDeactivate);
    }
}
