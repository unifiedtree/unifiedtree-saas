package com.unifiedtree.saas.marketing;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.unifiedtree.saas.admin.support.PageResult;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

/**
 * WhatsApp (Meta) usage and which company owns which WhatsApp Business Account —
 * the internal foundation for billing usage through UnifiedTree (V144.106).
 *
 * <p>Pooled billing is NOT active: Meta's partner / line-of-credit approval does not
 * exist yet. Every channel defaults to DIRECT_CUSTOMER (Meta bills the customer), and
 * {@link #setBillingMode} refuses UNIFIEDTREE_POOLED / HYBRID while
 * {@code billing_settings.marketing_pooled_billing_enabled} is false. Usage is
 * recorded (idempotently) so it can be seen and reconciled before any money moves;
 * no price is invented — rating needs a rate card that someone entered with its source.
 */
@Service
public class MarketingUsageService {

    static final String PROVIDER = "META_WHATSAPP";
    static final Set<String> MODES = Set.of("DIRECT_CUSTOMER", "UNIFIEDTREE_POOLED", "HYBRID");
    static final Set<String> USAGE_TYPES = Set.of("CONVERSATION", "MESSAGE");

    /** Bounds on one event: how late it may arrive, how far ahead a clock may be, and its size. */
    static final Duration MAX_AGE = Duration.ofDays(90);
    static final Duration MAX_FUTURE = Duration.ofMinutes(5);
    static final BigDecimal MAX_QUANTITY = BigDecimal.valueOf(10_000);
    /** The longest window a usage summary covers. */
    static final Duration MAX_SUMMARY_WINDOW = Duration.ofDays(366);

    private final JdbcTemplate jdbc;
    private final ObjectMapper json;

    public MarketingUsageService(JdbcTemplate jdbc, ObjectMapper json) {
        this.jdbc = jdbc;
        this.json = json;
    }

    public record ChannelAccount(UUID id, UUID tenantId, UUID companyId, String provider, String wabaId,
                                 String displayName, String billingMode, BigDecimal monthlySpendLimit,
                                 String currency, String status, Instant createdAt, Instant updatedAt) {}

    public record UsageEvent(String idempotencyKey, UUID tenantId, UUID companyId, String wabaId,
                             String phoneNumberId, String providerEventId, String usageType, String category,
                             String market, Instant occurredAt, BigDecimal quantity, Map<String, Object> raw) {}

    public record UsageRecorded(boolean recorded, boolean duplicate, UUID id, String billingMode) {}

    public record UsageSummary(UUID tenantId, UUID companyId, Instant from, Instant to, long events,
                               List<Map<String, Object>> byCategory, List<Map<String, Object>> byDay,
                               long unreconciled, boolean pooledBillingEnabled) {}

    // ── Channel accounts ────────────────────────────────────────────────────

    /** Record that a company connected a WABA. Never silently moves a WABA to another company. */
    @Transactional
    public ChannelAccount connectChannel(UUID tenantId, UUID companyId, String wabaId, String displayName) {
        if (wabaId == null || !wabaId.matches("^[0-9A-Za-z_-]{3,64}$")) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "wabaId is required");
        }
        int n;
        try {
            n = jdbc.update("""
                    INSERT INTO platform.marketing_channel_accounts (tenant_id, company_id, provider, waba_id, display_name)
                    VALUES (?, ?, ?, ?, ?)
                    ON CONFLICT (provider, waba_id) DO UPDATE
                       SET display_name = coalesce(EXCLUDED.display_name, platform.marketing_channel_accounts.display_name),
                           status = 'ACTIVE', updated_at = now()
                     WHERE platform.marketing_channel_accounts.company_id = EXCLUDED.company_id
                    """, tenantId, companyId, PROVIDER, wabaId, displayName);
        } catch (DataIntegrityViolationException e) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "That company is not in that workspace");
        }
        if (n == 0) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "That WhatsApp Business Account is registered to a different company");
        }
        return channel(PROVIDER, wabaId);
    }

    public PageResult<ChannelAccount> channels(UUID tenantId, UUID companyId, int page, int size) {
        List<Object> args = new ArrayList<>();
        StringBuilder where = new StringBuilder(" WHERE TRUE");
        if (tenantId != null) { where.append(" AND tenant_id = ?"); args.add(tenantId); }
        if (companyId != null) { where.append(" AND company_id = ?"); args.add(companyId); }
        Long total = jdbc.queryForObject("SELECT count(*) FROM platform.marketing_channel_accounts" + where,
                Long.class, args.toArray());
        List<Object> pageArgs = new ArrayList<>(args);
        pageArgs.add(size);
        pageArgs.add((long) page * size);
        List<ChannelAccount> rows = jdbc.query("SELECT * FROM platform.marketing_channel_accounts" + where
                + " ORDER BY created_at DESC, id LIMIT ? OFFSET ?", this::mapChannel, pageArgs.toArray());
        return PageResult.of(rows, page, size, total == null ? 0 : total);
    }

    @Transactional
    public ChannelAccount setBillingMode(UUID channelId, String mode, BigDecimal monthlySpendLimit) {
        String m = mode == null ? "" : mode.trim().toUpperCase(Locale.ROOT);
        if (!MODES.contains(m)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "billingMode must be DIRECT_CUSTOMER, UNIFIEDTREE_POOLED or HYBRID");
        }
        if (!"DIRECT_CUSTOMER".equals(m) && !pooledEnabled()) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "POOLED_BILLING_DISABLED: UnifiedTree cannot bill WhatsApp usage on the customer's behalf until "
                            + "Meta's partner / line-of-credit approval is in place");
        }
        if (monthlySpendLimit != null && monthlySpendLimit.signum() < 0) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "monthlySpendLimit cannot be negative");
        }
        int n = jdbc.update("""
                UPDATE platform.marketing_channel_accounts
                   SET billing_mode = ?, monthly_spend_limit = ?, updated_at = now() WHERE id = ?
                """, m, monthlySpendLimit, channelId);
        if (n == 0) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Channel account not found");
        return jdbc.queryForObject("SELECT * FROM platform.marketing_channel_accounts WHERE id = ?",
                this::mapChannel, channelId);
    }

    // ── Usage ───────────────────────────────────────────────────────────────

    /**
     * Record one provider event; a redelivered event (same idempotency key) is not recorded twice. The key
     * is global, so the event's billing fields are hashed and stored with it: the same key with different
     * fields is a 409 (IDEMPOTENCY_MISMATCH), not a silent drop. occurredAt must lie within
     * {@link #MAX_AGE} before now and {@link #MAX_FUTURE} after it; quantity is at most {@link #MAX_QUANTITY}.
     */
    @Transactional
    public UsageRecorded record(UsageEvent e) {
        if (e.idempotencyKey() == null || e.idempotencyKey().isBlank() || e.idempotencyKey().length() > 200) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "idempotencyKey is required (max 200)");
        }
        String type = e.usageType() == null ? "" : e.usageType().trim().toUpperCase(Locale.ROOT);
        if (!USAGE_TYPES.contains(type)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "usageType must be CONVERSATION or MESSAGE");
        }
        if (e.tenantId() == null || e.companyId() == null || e.occurredAt() == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "tenantId, companyId and occurredAt are required");
        }
        BigDecimal qty = e.quantity() == null ? BigDecimal.ONE : e.quantity();
        if (qty.signum() <= 0 || qty.compareTo(MAX_QUANTITY) > 0) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "quantity must be between 0 and " + MAX_QUANTITY);
        }
        Instant now = Instant.now();
        if (e.occurredAt().isBefore(now.minus(MAX_AGE)) || e.occurredAt().isAfter(now.plus(MAX_FUTURE))) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "occurredAt must be within the last " + MAX_AGE.toDays() + " days and not in the future");
        }
        String key = e.idempotencyKey().trim();
        String hash = payloadHash(e, type, qty);

        Map<String, Object> channel = e.wabaId() == null ? null : jdbc.queryForList("""
                SELECT id, billing_mode, company_id FROM platform.marketing_channel_accounts
                 WHERE provider = ? AND waba_id = ?
                """, PROVIDER, e.wabaId()).stream().findFirst().orElse(null);
        if (channel != null && !e.companyId().equals(channel.get("company_id"))) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "That WABA belongs to a different company; usage was not recorded");
        }
        String mode = channel == null ? "DIRECT_CUSTOMER" : (String) channel.get("billing_mode");
        String raw;
        try {
            raw = e.raw() == null ? null : json.writeValueAsString(e.raw());
        } catch (Exception ex) {
            raw = null;
        }
        List<UUID> inserted;
        try {
            inserted = jdbc.query("""
                    INSERT INTO platform.usage_ledger
                           (idempotency_key, payload_hash, tenant_id, company_id, channel_account_id, provider, waba_id,
                            phone_number_id, provider_event_id, usage_type, category, market, occurred_at, quantity,
                            billing_mode, raw)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?::jsonb)
                    ON CONFLICT (idempotency_key) DO NOTHING
                    RETURNING id
                    """, (rs, i) -> rs.getObject(1, UUID.class), key, hash, e.tenantId(),
                    e.companyId(), channel == null ? null : channel.get("id"), PROVIDER, e.wabaId(),
                    e.phoneNumberId(), e.providerEventId(), type, upper(e.category()), upper(e.market()),
                    Timestamp.from(e.occurredAt()), qty, mode, raw);
        } catch (DataIntegrityViolationException ex) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "That company is not in that workspace");
        }
        if (!inserted.isEmpty()) return new UsageRecorded(true, false, inserted.get(0), mode);
        Map<String, Object> held = jdbc.queryForList(
                "SELECT id, payload_hash FROM platform.usage_ledger WHERE idempotency_key = ?", key)
                .stream().findFirst().orElse(null);
        // A row from before payload hashes has none: it is treated as the same event
        if (held != null && held.get("payload_hash") != null && !hash.equals(held.get("payload_hash"))) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "IDEMPOTENCY_MISMATCH: That idempotencyKey was "
                    + "already recorded for a different event; usage was not recorded");
        }
        return new UsageRecorded(false, true, held == null ? null : (UUID) held.get("id"), mode);
    }

    /**
     * SHA-256 over the fields that make the event billable (who, which channel, what, when, how much). The
     * raw provider payload is not part of it: a redelivery may differ in delivery metadata, not in these.
     */
    static String payloadHash(UsageEvent e, String type, BigDecimal qty) {
        String canonical = String.join("\n", String.valueOf(e.tenantId()), String.valueOf(e.companyId()),
                String.valueOf(e.wabaId()), String.valueOf(e.phoneNumberId()), String.valueOf(e.providerEventId()),
                type, String.valueOf(upper(e.category())), String.valueOf(upper(e.market())),
                e.occurredAt().truncatedTo(ChronoUnit.MILLIS).toString(), qty.stripTrailingZeros().toPlainString());
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest(canonical.getBytes(StandardCharsets.UTF_8)));
        } catch (java.security.NoSuchAlgorithmException ex) {
            throw new IllegalStateException(ex);
        }
    }

    public UsageSummary summary(UUID tenantId, UUID companyId, Instant from, Instant to) {
        Instant f = from == null ? Instant.now().minusSeconds(30L * 24 * 3600) : from;
        Instant t = to == null ? Instant.now() : to;
        if (!t.isAfter(f) || Duration.between(f, t).compareTo(MAX_SUMMARY_WINDOW) > 0) {
            // byDay has one row per day: a bounded window keeps the summary a bounded size
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "from must be before to, at most " + MAX_SUMMARY_WINDOW.toDays() + " days apart");
        }
        List<Object> args = new ArrayList<>(List.of(Timestamp.from(f), Timestamp.from(t)));
        StringBuilder where = new StringBuilder(" WHERE occurred_at >= ? AND occurred_at < ? AND status <> 'VOID'");
        if (tenantId != null) { where.append(" AND tenant_id = ?"); args.add(tenantId); }
        if (companyId != null) { where.append(" AND company_id = ?"); args.add(companyId); }
        Long events = jdbc.queryForObject("SELECT count(*) FROM platform.usage_ledger" + where, Long.class,
                args.toArray());
        List<Map<String, Object>> byCategory = jdbc.queryForList("""
                SELECT coalesce(category, 'UNCATEGORISED') AS category, usage_type, count(*) AS events,
                       sum(quantity) AS quantity, sum(provider_cost) AS provider_cost, max(currency) AS currency
                  FROM platform.usage_ledger
                """ + where + " GROUP BY 1, 2 ORDER BY 3 DESC", args.toArray());
        List<Map<String, Object>> byDay = jdbc.queryForList("""
                SELECT (occurred_at AT TIME ZONE 'Asia/Kolkata')::date AS day, count(*) AS events
                  FROM platform.usage_ledger
                """ + where + " GROUP BY 1 ORDER BY 1", args.toArray());
        Long unreconciled = jdbc.queryForObject("SELECT count(*) FROM platform.usage_ledger" + where
                + " AND reconciliation_status <> 'MATCHED'", Long.class, args.toArray());
        return new UsageSummary(tenantId, companyId, f, t, events == null ? 0 : events, byCategory, byDay,
                unreconciled == null ? 0 : unreconciled, pooledEnabled());
    }

    boolean pooledEnabled() {
        Boolean on = jdbc.queryForObject(
                "SELECT marketing_pooled_billing_enabled FROM platform.billing_settings WHERE id = 1", Boolean.class);
        return Boolean.TRUE.equals(on);
    }

    private ChannelAccount channel(String provider, String wabaId) {
        return jdbc.queryForObject("SELECT * FROM platform.marketing_channel_accounts WHERE provider = ? AND waba_id = ?",
                this::mapChannel, provider, wabaId);
    }

    private ChannelAccount mapChannel(ResultSet rs, int i) throws SQLException {
        return new ChannelAccount(rs.getObject("id", UUID.class), rs.getObject("tenant_id", UUID.class),
                rs.getObject("company_id", UUID.class), rs.getString("provider"), rs.getString("waba_id"),
                rs.getString("display_name"), rs.getString("billing_mode"), rs.getBigDecimal("monthly_spend_limit"),
                rs.getString("currency"), rs.getString("status"), instant(rs, "created_at"),
                instant(rs, "updated_at"));
    }

    private static String upper(String s) {
        return s == null || s.isBlank() ? null : s.trim().toUpperCase(Locale.ROOT);
    }

    private static Instant instant(ResultSet rs, String column) throws SQLException {
        Timestamp t = rs.getTimestamp(column);
        return t == null ? null : t.toInstant();
    }
}
