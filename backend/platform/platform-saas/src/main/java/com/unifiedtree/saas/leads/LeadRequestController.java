package com.unifiedtree.saas.leads;

import com.unifiedtree.saas.event.LeadRequestReceivedEvent;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.dao.DataAccessException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.Instant;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

/**
 * Unauthenticated marketing-lead intake for the public website's
 * "Request demo" and "Contact sales" forms. Mounted under {@code /v1/public}
 * so the canonical-prod security config's {@code permitAll()} rule lets
 * anonymous traffic in.
 *
 * <p>Two side effects, both best-effort so a single failure never loses a
 * lead:
 * <ol>
 *   <li>INSERT into {@code platform.lead_requests} (V091). Failure is logged
 *       but does not fail the request — email is still fired.</li>
 *   <li>Publish {@link LeadRequestReceivedEvent} which a listener in
 *       {@code hrms-api} translates into an email to
 *       {@code unifiedtree@gmail.com}. The listener is {@code @Async} and
 *       swallows its own failures.</li>
 * </ol>
 * A structured INFO log line is always written so ops can grep for leads even
 * if both channels drop.
 */
@RestController
@RequestMapping("/v1/public")
public class LeadRequestController {

    private static final Logger log = LoggerFactory.getLogger(LeadRequestController.class);

    private final JdbcTemplate jdbc;
    private final ApplicationEventPublisher events;

    public LeadRequestController(JdbcTemplate jdbc, ApplicationEventPublisher events) {
        this.jdbc = jdbc;
        this.events = events;
    }

    /**
     * Request body accepted by both marketing forms. The shape is the union of
     * the two — the frontend sends whatever it collects and leaves the rest
     * null. Only intent + name + workEmail are structurally required.
     */
    public record LeadRequest(
            @NotBlank @Size(max = 16)  String intent,      // "demo" | "sales"
            @NotBlank @Size(max = 150) String name,
            @NotBlank @Email @Size(max = 255) String workEmail,
            @Size(max = 150) String company,
            @Size(max = 30)  String size,        // demo form
            @Size(max = 30)  String employees,   // sales form
            @Size(max = 100) String preferred,   // demo form
            @Size(max = 30)  String timeline,    // sales form
            @Size(max = 2000) String notes,      // demo form
            @Size(max = 2000) String message     // sales form
    ) {}

    @PostMapping("/lead-request")
    public ResponseEntity<Map<String, Object>> submit(@Valid @RequestBody LeadRequest req,
                                                      HttpServletRequest httpReq) {
        String intent = normIntent(req.intent());
        UUID leadId = UUID.randomUUID();
        Instant now = Instant.now();
        String companySize = req.size() != null ? req.size() : req.employees();
        String ua = truncate(httpReq.getHeader("User-Agent"), 400);
        String ip = clientIp(httpReq);

        // 1. Structured log — the last-resort record that a lead came in, so it
        //    goes first and is always emitted regardless of the two side-effects.
        //    B11 (2026-08-14): do NOT log workEmail / preferred contact time / free-text
        //    notes/message. Those are PII the marketing form collects on behalf of the
        //    prospect — application logs ship to Cloud Logging where retention and
        //    audience are much wider than the platform.lead_requests table. Log only
        //    the correlation id + non-identifying descriptors; anything else lives in
        //    the DB row and the event payload.
        log.info("lead-request received id={} intent={} company={}",
                leadId, intent, req.company());

        // 2. Best-effort persistence. Missing table (migration not yet applied
        //    in one environment) or any other DataAccessException degrades to a
        //    warning — we still fire the email so the lead is not lost.
        try {
            jdbc.update("""
                    INSERT INTO platform.lead_requests
                        (id, intent, name, email, company, company_size,
                         preferred_time, timeline, notes, message,
                         user_agent, ip_address, received_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    leadId, intent, req.name(), req.workEmail(), req.company(), companySize,
                    req.preferred(), req.timeline(), req.notes(), req.message(),
                    ua, ip, java.sql.Timestamp.from(now));
        } catch (DataAccessException e) {
            log.warn("lead-request: failed to insert into platform.lead_requests (best-effort) — {}", e.getMessage());
        } catch (Exception e) {
            log.warn("lead-request: unexpected insert failure (best-effort)", e);
        }

        // 3. Fire event → hrms-api mail listener sends the notification.
        try {
            events.publishEvent(new LeadRequestReceivedEvent(
                    leadId, intent, req.name(), req.workEmail(), req.company(), companySize,
                    req.preferred(), req.timeline(), req.notes(), req.message(),
                    ua, ip, now));
        } catch (Exception e) {
            // Event bus is in-process — publish is essentially infallible, but
            // listeners run inline for non-@Async ones and could throw. The
            // welcome-email listener is @Async and swallows, so this is a
            // safety net only.
            log.warn("lead-request: event publish threw (mail may not be sent)", e);
        }

        return ResponseEntity.status(HttpStatus.ACCEPTED)
                .body(Map.of("status", "received", "leadId", leadId));
    }

    /** Force one of {"demo","sales"}; anything else is filed as "unknown". */
    private static String normIntent(String s) {
        if (s == null) return "unknown";
        String v = s.trim().toLowerCase(Locale.ROOT);
        return switch (v) {
            case "demo", "sales" -> v;
            default -> "unknown";
        };
    }

    /**
     * Prefer the first hop in {@code X-Forwarded-For} (set by Cloud Run's front
     * end), falling back to the socket peer. Bounded so the ::inet cast never
     * receives a giant string.
     */
    private static String clientIp(HttpServletRequest req) {
        String xff = req.getHeader("X-Forwarded-For");
        if (xff != null && !xff.isBlank()) {
            int comma = xff.indexOf(',');
            String first = (comma < 0 ? xff : xff.substring(0, comma)).trim();
            if (!first.isBlank()) return truncate(first, 64);
        }
        return truncate(req.getRemoteAddr(), 64);
    }

    private static String truncate(String s, int max) {
        if (s == null) return null;
        return s.length() <= max ? s : s.substring(0, max);
    }
}
