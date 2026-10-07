package com.unifiedtree.saas.admin.billing;

import com.unifiedtree.saas.admin.directory.PlatformDirectoryService;
import com.unifiedtree.saas.admin.support.PageResult;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.math.BigDecimal;
import java.sql.Array;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;

import java.util.UUID;
import java.util.regex.Pattern;

/**
 * Subscriptions, payments, company billing profiles and billing settings, as the
 * admin console reads and edits them. Reads the same {@code platform.subscriptions}
 * and {@code platform.payments} that the Razorpay integration writes — UnifiedTree's
 * billing is the single commercial authority, not Marketing's old SaaS billing.
 */
@Service
public class PlatformBillingService {

    private static final Pattern GSTIN = Pattern.compile("^[0-9]{2}[A-Z0-9]{13}$");
    private static final Pattern PAN = Pattern.compile("^[A-Z]{5}[0-9]{4}[A-Z]$");
    private static final Pattern STATE_CODE = Pattern.compile("^[0-9]{2}$");

    private final JdbcTemplate jdbc;
    private final PlatformDirectoryService directory;

    public PlatformBillingService(JdbcTemplate jdbc, PlatformDirectoryService directory) {
        this.jdbc = jdbc;
        this.directory = directory;
    }

    public record SubscriptionRow(UUID id, UUID tenantId, String workspaceSubdomain, UUID companyId,
                                  List<String> planKeys, List<String> modules, int seats, String billingCycle,
                                  BigDecimal unitPriceInr, BigDecimal amountInr, String currency, String status,
                                  String planType, Instant currentPeriodStart, Instant currentPeriodEnd,
                                  Instant nextChargeAt, Instant trialEndsAt, Instant graceUntil, boolean autoRenew,
                                  String paymentMethod, String razorpaySubscriptionId, String lastRazorpayStatus,
                                  Instant createdAt) {}

    public record PaymentRow(UUID id, UUID tenantId, String workspaceSubdomain, String razorpayOrderId,
                             String razorpayPaymentId, BigDecimal amountInr, String currency, String status,
                             int seats, List<String> planKeys, String billingCycle, int periodMonths,
                             boolean signatureVerified, Instant createdAt, Instant paidAt, UUID invoiceId,
                             String invoiceNumber) {}

    public record BillingProfile(UUID companyId, UUID tenantId, String legalName, String gstin, String pan,
                                 String billingEmail, String billingPhone, String addressLine1, String addressLine2,
                                 String city, String state, String stateCode, String postalCode, String country,
                                 String currency, String updatedBy, Instant updatedAt) {}

    public record BillingSettings(boolean trialEnabled, int trialDays, String sellerLegalName, String sellerGstin,
                                  String sellerPan, String sellerAddress, String sellerStateCode, String sellerEmail,
                                  String invoicePrefix, BigDecimal defaultGstRatePct, int invoiceDueDays,
                                  boolean marketingPooledBillingEnabled, Instant updatedAt) {}

    // ── Subscriptions ───────────────────────────────────────────────────────

    public PageResult<SubscriptionRow> subscriptions(UUID tenantId, UUID companyId, String status, String planKey,
                                                     int page, int size) {
        List<Object> args = new ArrayList<>();
        StringBuilder where = new StringBuilder(" WHERE TRUE");
        if (tenantId != null) { where.append(" AND s.tenant_id = ?"); args.add(tenantId); }
        if (companyId != null) { where.append(" AND s.company_id = ?"); args.add(companyId); }
        if (status != null && !status.isBlank()) {
            where.append(" AND s.status = ?");
            args.add(status.trim().toUpperCase(Locale.ROOT));
        }
        if (planKey != null && !planKey.isBlank()) {
            where.append(" AND ? = ANY (s.plan_keys)");
            args.add(planKey.trim());
        }
        Long total = jdbc.queryForObject("SELECT count(*) FROM platform.subscriptions s" + where, Long.class,
                args.toArray());
        List<Object> pageArgs = new ArrayList<>(args);
        pageArgs.add(size);
        pageArgs.add((long) page * size);
        List<SubscriptionRow> rows = jdbc.query("""
                SELECT s.*, t.subdomain FROM platform.subscriptions s
                  LEFT JOIN platform.tenants t ON t.id = s.tenant_id
                """ + where + " ORDER BY s.created_at DESC LIMIT ? OFFSET ?", this::mapSubscription,
                pageArgs.toArray());
        return PageResult.of(rows, page, size, total == null ? 0 : total);
    }

    // ── Payments ────────────────────────────────────────────────────────────

    public PageResult<PaymentRow> payments(UUID tenantId, String status, int page, int size) {
        List<Object> args = new ArrayList<>();
        StringBuilder where = new StringBuilder(" WHERE TRUE");
        if (tenantId != null) { where.append(" AND p.tenant_id = ?"); args.add(tenantId); }
        if (status != null && !status.isBlank()) {
            where.append(" AND p.status = ?");
            args.add(status.trim().toUpperCase(Locale.ROOT));
        }
        Long total = jdbc.queryForObject("SELECT count(*) FROM platform.payments p" + where, Long.class,
                args.toArray());
        List<Object> pageArgs = new ArrayList<>(args);
        pageArgs.add(size);
        pageArgs.add((long) page * size);
        List<PaymentRow> rows = jdbc.query("""
                SELECT p.*, t.subdomain, i.id AS invoice_id, i.invoice_number
                  FROM platform.payments p
                  LEFT JOIN platform.tenants t ON t.id = p.tenant_id
                  LEFT JOIN platform.invoices i ON i.payment_id = p.id AND i.status <> 'VOID'
                """ + where + " ORDER BY coalesce(p.paid_at, p.created_at) DESC LIMIT ? OFFSET ?",
                (rs, i) -> new PaymentRow(rs.getObject("id", UUID.class), rs.getObject("tenant_id", UUID.class),
                        rs.getString("subdomain"), rs.getString("razorpay_order_id"),
                        rs.getString("razorpay_payment_id"), rs.getBigDecimal("amount_inr"), rs.getString("currency"),
                        rs.getString("status"), rs.getInt("seats"), strings(rs.getArray("plan_keys")),
                        rs.getString("billing_cycle"), rs.getInt("period_months"), rs.getBoolean("signature_verified"),
                        instant(rs, "created_at"), instant(rs, "paid_at"), rs.getObject("invoice_id", UUID.class),
                        rs.getString("invoice_number")),
                pageArgs.toArray());
        return PageResult.of(rows, page, size, total == null ? 0 : total);
    }

    // ── Company billing profile ─────────────────────────────────────────────

    public BillingProfile billingProfile(UUID tenantId, UUID companyId) {
        directory.requireCompany(tenantId, companyId);
        List<BillingProfile> rows = jdbc.query("""
                SELECT * FROM platform.company_billing_profiles WHERE company_id = ? AND tenant_id = ?
                """, this::mapProfile, companyId, tenantId);
        return rows.isEmpty() ? new BillingProfile(companyId, tenantId, null, null, null, null, null, null, null,
                null, null, null, null, "IN", "INR", null, null) : rows.get(0);
    }

    @Transactional
    public BillingProfile saveBillingProfile(UUID tenantId, UUID companyId, BillingProfile in, String updatedBy) {
        directory.requireCompany(tenantId, companyId);
        String gstin = upper(in.gstin());
        String pan = upper(in.pan());
        if (gstin != null && !GSTIN.matcher(gstin).matches()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "GSTIN must be 15 characters, e.g. 29ABCDE1234F1Z5");
        }
        if (pan != null && !PAN.matcher(pan).matches()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "PAN must look like ABCDE1234F");
        }
        String stateCode = blank(in.stateCode());
        if (stateCode != null && !STATE_CODE.matcher(stateCode).matches()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "stateCode is the two-digit GST state code");
        }
        if (gstin != null && stateCode != null && !gstin.startsWith(stateCode)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "The GSTIN's first two digits (" + gstin.substring(0, 2) + ") must match the state code");
        }
        String email = blank(in.billingEmail());
        if (email != null && !email.contains("@")) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "billingEmail is not an email address");
        }
        jdbc.update("""
                INSERT INTO platform.company_billing_profiles
                       (company_id, tenant_id, legal_name, gstin, pan, billing_email, billing_phone, address_line1,
                        address_line2, city, state, state_code, postal_code, country, currency, updated_by)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT (company_id) DO UPDATE SET
                       legal_name = EXCLUDED.legal_name, gstin = EXCLUDED.gstin, pan = EXCLUDED.pan,
                       billing_email = EXCLUDED.billing_email, billing_phone = EXCLUDED.billing_phone,
                       address_line1 = EXCLUDED.address_line1, address_line2 = EXCLUDED.address_line2,
                       city = EXCLUDED.city, state = EXCLUDED.state, state_code = EXCLUDED.state_code,
                       postal_code = EXCLUDED.postal_code, country = EXCLUDED.country, currency = EXCLUDED.currency,
                       updated_by = EXCLUDED.updated_by, updated_at = now()
                """, companyId, tenantId, blank(in.legalName()), gstin, pan, email, blank(in.billingPhone()),
                blank(in.addressLine1()), blank(in.addressLine2()), blank(in.city()), blank(in.state()), stateCode,
                blank(in.postalCode()), in.country() == null ? "IN" : in.country().trim().toUpperCase(Locale.ROOT),
                in.currency() == null ? "INR" : in.currency().trim().toUpperCase(Locale.ROOT), updatedBy);
        return billingProfile(tenantId, companyId);
    }

    // ── Billing settings ────────────────────────────────────────────────────

    public BillingSettings settings() {
        return jdbc.queryForObject("SELECT * FROM platform.billing_settings WHERE id = 1",
                (rs, i) -> new BillingSettings(rs.getBoolean("trial_enabled"), rs.getInt("trial_days"),
                        rs.getString("seller_legal_name"), rs.getString("seller_gstin"), rs.getString("seller_pan"),
                        rs.getString("seller_address"), rs.getString("seller_state_code"),
                        rs.getString("seller_email"), rs.getString("invoice_prefix"),
                        rs.getBigDecimal("default_gst_rate_pct"), rs.getInt("invoice_due_days"),
                        rs.getBoolean("marketing_pooled_billing_enabled"), instant(rs, "updated_at")));
    }

    /**
     * The seller details printed on invoices, GST rate, prefix and due days. Deliberately
     * cannot switch pooled Meta billing on: that needs Meta's approval first and is a
     * hand-applied change, so no console click can label customers as pooled.
     */
    @Transactional
    public BillingSettings saveSettings(BillingSettings in) {
        String gstin = upper(in.sellerGstin());
        if (gstin != null && !GSTIN.matcher(gstin).matches()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "sellerGstin is not a valid GSTIN");
        }
        String pan = upper(in.sellerPan());
        if (pan != null && !PAN.matcher(pan).matches()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "sellerPan is not a valid PAN");
        }
        if (in.defaultGstRatePct() != null
                && (in.defaultGstRatePct().signum() < 0 || in.defaultGstRatePct().compareTo(BigDecimal.valueOf(100)) > 0)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "defaultGstRatePct must be 0-100");
        }
        String prefix = blank(in.invoicePrefix());
        // PREFIX/26-27/00001 must stay within GST's 16-character limit for invoice numbers
        if (prefix != null && !prefix.matches("^[A-Z0-9]{1,4}$")) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "invoicePrefix: 1-4 capital letters or digits (GST invoice numbers are at most 16 characters)");
        }
        if (in.invoiceDueDays() < 0 || in.invoiceDueDays() > 365) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "invoiceDueDays must be 0-365");
        }
        jdbc.update("""
                UPDATE platform.billing_settings
                   SET seller_legal_name = ?, seller_gstin = ?, seller_pan = ?, seller_address = ?,
                       seller_state_code = ?, seller_email = ?, invoice_prefix = coalesce(?, invoice_prefix),
                       default_gst_rate_pct = coalesce(?, default_gst_rate_pct), invoice_due_days = ?,
                       updated_at = now()
                 WHERE id = 1
                """, blank(in.sellerLegalName()), gstin, pan, blank(in.sellerAddress()), blank(in.sellerStateCode()),
                blank(in.sellerEmail()), prefix, in.defaultGstRatePct(), in.invoiceDueDays());
        return settings();
    }

    // ── mapping ─────────────────────────────────────────────────────────────

    private SubscriptionRow mapSubscription(ResultSet rs, int i) throws SQLException {
        return new SubscriptionRow(rs.getObject("id", UUID.class), rs.getObject("tenant_id", UUID.class),
                rs.getString("subdomain"), rs.getObject("company_id", UUID.class), strings(rs.getArray("plan_keys")),
                strings(rs.getArray("modules")), rs.getInt("seats"), rs.getString("billing_cycle"),
                rs.getBigDecimal("unit_price_inr"), rs.getBigDecimal("amount_inr"), rs.getString("currency"),
                rs.getString("status"), rs.getString("plan_type"), instant(rs, "current_period_start"),
                instant(rs, "current_period_end"), instant(rs, "next_charge_at"), instant(rs, "trial_ends_at"),
                instant(rs, "grace_until"), rs.getBoolean("auto_renew"), rs.getString("payment_method"),
                rs.getString("razorpay_subscription_id"), rs.getString("last_razorpay_status"),
                instant(rs, "created_at"));
    }

    private BillingProfile mapProfile(ResultSet rs, int i) throws SQLException {
        return new BillingProfile(rs.getObject("company_id", UUID.class), rs.getObject("tenant_id", UUID.class),
                rs.getString("legal_name"), rs.getString("gstin"), rs.getString("pan"), rs.getString("billing_email"),
                rs.getString("billing_phone"), rs.getString("address_line1"), rs.getString("address_line2"),
                rs.getString("city"), rs.getString("state"), rs.getString("state_code"), rs.getString("postal_code"),
                rs.getString("country"), rs.getString("currency"), rs.getString("updated_by"),
                instant(rs, "updated_at"));
    }

    static List<String> strings(Array a) throws SQLException {
        if (a == null) return List.of();
        Object raw = a.getArray();
        return raw instanceof String[] s ? Arrays.asList(s) : List.of();
    }

    private static String blank(String s) {
        return s == null || s.isBlank() ? null : s.strip();
    }

    private static String upper(String s) {
        String b = blank(s);
        return b == null ? null : b.toUpperCase(Locale.ROOT);
    }

    static Instant instant(ResultSet rs, String column) throws SQLException {
        Timestamp t = rs.getTimestamp(column);
        return t == null ? null : t.toInstant();
    }
}
