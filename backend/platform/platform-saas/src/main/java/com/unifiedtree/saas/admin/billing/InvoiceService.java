package com.unifiedtree.saas.admin.billing;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.unifiedtree.saas.admin.directory.PlatformDirectoryService;
import com.unifiedtree.saas.admin.support.PageResult;
import com.unifiedtree.saas.admin.support.TenantScopedReader;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

/**
 * SaaS invoices: draft, issue (number + frozen billing snapshot), void.
 *
 * <p>An invoice is created as a DRAFT, so an operator sees it before it becomes a
 * legal document. Issuing gives it the next number in the financial-year series
 * ({@code UT/2026-27/000001}) and freezes a copy of the seller's and buyer's
 * details; from then on the database refuses any change to its money, parties,
 * snapshot or lines (V144.104 triggers). The only correction is void + re-issue.
 *
 * <p>Not wired into the live Razorpay webhook: invoices are issued from the admin
 * console for now, so the payment path that earns money today is unchanged.
 */
@Service
public class InvoiceService {

    static final ZoneId INDIA = ZoneId.of("Asia/Kolkata");

    private final JdbcTemplate jdbc;
    private final ObjectMapper json;
    private final PlatformDirectoryService directory;
    private final TenantScopedReader scoped;

    public InvoiceService(JdbcTemplate jdbc, ObjectMapper json, PlatformDirectoryService directory,
                          TenantScopedReader scoped) {
        this.jdbc = jdbc;
        this.json = json;
        this.directory = directory;
        this.scoped = scoped;
    }

    public record LineInput(String description, String planKey, String moduleKey, BigDecimal quantity,
                            BigDecimal unitPrice, BigDecimal discount, Instant periodStart, Instant periodEnd) {}

    public record DraftInput(UUID tenantId, UUID companyId, UUID subscriptionId, UUID paymentId,
                             BigDecimal taxRatePct, List<LineInput> lines, String notes) {}

    public record InvoiceLine(UUID id, int lineNo, String planKey, String moduleKey, UUID priceVersionId,
                              String description, BigDecimal quantity, BigDecimal unitPrice, BigDecimal discount,
                              BigDecimal taxRatePct, BigDecimal taxAmount, BigDecimal amount, Instant periodStart,
                              Instant periodEnd) {}

    public record Invoice(UUID id, String invoiceNumber, UUID tenantId, String workspaceSubdomain, UUID companyId,
                          UUID subscriptionId, UUID paymentId, String status, String currency, BigDecimal subtotal,
                          BigDecimal discountTotal, BigDecimal taxTotal, BigDecimal total, BigDecimal amountPaid,
                          Instant periodStart, Instant periodEnd, Instant issuedAt, Instant dueAt, Instant paidAt,
                          Instant voidedAt, String voidReason, Map<String, Object> billingSnapshot, String notes,
                          String createdBy, Instant createdAt, List<InvoiceLine> lines) {}

    // ── Reads ───────────────────────────────────────────────────────────────

    public PageResult<Invoice> list(UUID tenantId, UUID companyId, String status, int page, int size) {
        List<Object> args = new ArrayList<>();
        StringBuilder where = new StringBuilder(" WHERE TRUE");
        if (tenantId != null) { where.append(" AND i.tenant_id = ?"); args.add(tenantId); }
        if (companyId != null) { where.append(" AND i.company_id = ?"); args.add(companyId); }
        if (status != null && !status.isBlank()) {
            where.append(" AND i.status = ?");
            args.add(status.trim().toUpperCase(Locale.ROOT));
        }
        Long total = jdbc.queryForObject("SELECT count(*) FROM platform.invoices i" + where, Long.class,
                args.toArray());
        List<Object> pageArgs = new ArrayList<>(args);
        pageArgs.add(size);
        pageArgs.add((long) page * size);
        List<Invoice> rows = jdbc.query(selectSql() + where
                        + " ORDER BY coalesce(i.issued_at, i.created_at) DESC LIMIT ? OFFSET ?",
                (rs, i) -> map(rs, List.of()), pageArgs.toArray());
        return PageResult.of(rows, page, size, total == null ? 0 : total);
    }

    public Invoice get(UUID id) {
        List<Invoice> rows = jdbc.query(selectSql() + " WHERE i.id = ?", (rs, i) -> map(rs, lines(id)), id);
        if (rows.isEmpty()) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Invoice not found");
        return rows.get(0);
    }

    // ── Draft ───────────────────────────────────────────────────────────────

    @Transactional
    public Invoice createDraft(DraftInput in, String createdBy) {
        directory.requireWorkspace(in.tenantId());
        if (in.companyId() != null) directory.requireCompany(in.tenantId(), in.companyId());
        if (in.lines() == null || in.lines().isEmpty()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "An invoice needs at least one line");
        }
        requireOwnedReferences(in);
        BigDecimal rate = in.taxRatePct() != null ? in.taxRatePct() : defaultGstRate();
        if (rate.signum() < 0 || rate.compareTo(BigDecimal.valueOf(100)) > 0) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "taxRatePct must be between 0 and 100");
        }

        List<InvoiceLine> computed = new ArrayList<>();
        BigDecimal subtotal = BigDecimal.ZERO, discounts = BigDecimal.ZERO, taxes = BigDecimal.ZERO;
        int n = 1;
        for (LineInput l : in.lines()) {
            if (l.description() == null || l.description().isBlank()) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Every line needs a description");
            }
            BigDecimal qty = l.quantity() == null ? BigDecimal.ONE : l.quantity();
            BigDecimal unit = money(l.unitPrice());
            BigDecimal discount = money(l.discount() == null ? BigDecimal.ZERO : l.discount());
            if (qty.signum() <= 0 || unit.signum() < 0 || discount.signum() < 0) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                        "Quantity must be positive; unit price and discount cannot be negative");
            }
            BigDecimal gross = money(qty.multiply(unit));
            if (discount.compareTo(gross) > 0) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "A line's discount exceeds its amount");
            }
            BigDecimal net = gross.subtract(discount);
            BigDecimal tax = money(net.multiply(rate).divide(BigDecimal.valueOf(100), 6, RoundingMode.HALF_UP));
            subtotal = subtotal.add(gross);
            discounts = discounts.add(discount);
            taxes = taxes.add(tax);
            computed.add(new InvoiceLine(UUID.randomUUID(), n++, l.planKey(), l.moduleKey(),
                    currentPriceVersion(l.planKey()), l.description().strip(), qty, unit, discount, rate, tax,
                    net.add(tax), l.periodStart(), l.periodEnd()));
        }
        BigDecimal total = subtotal.subtract(discounts).add(taxes);
        Instant periodStart = computed.stream().map(InvoiceLine::periodStart).filter(java.util.Objects::nonNull)
                .min(Instant::compareTo).orElse(null);
        Instant periodEnd = computed.stream().map(InvoiceLine::periodEnd).filter(java.util.Objects::nonNull)
                .max(Instant::compareTo).orElse(null);

        UUID id = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO platform.invoices
                       (id, tenant_id, company_id, subscription_id, payment_id, status, currency, subtotal,
                        discount_total, tax_total, total, period_start, period_end, notes, created_by)
                VALUES (?, ?, ?, ?, ?, 'DRAFT', 'INR', ?, ?, ?, ?, ?, ?, ?, ?)
                """, id, in.tenantId(), in.companyId(), in.subscriptionId(), in.paymentId(), subtotal, discounts,
                taxes, total, ts(periodStart), ts(periodEnd), in.notes(), createdBy);
        for (InvoiceLine l : computed) {
            jdbc.update("""
                    INSERT INTO platform.invoice_lines
                           (id, invoice_id, line_no, plan_key, module_key, price_version_id, description, quantity,
                            unit_price, discount, tax_rate_pct, tax_amount, amount, period_start, period_end)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """, l.id(), id, l.lineNo(), l.planKey(), l.moduleKey(), l.priceVersionId(), l.description(),
                    l.quantity(), l.unitPrice(), l.discount(), l.taxRatePct(), l.taxAmount(), l.amount(),
                    ts(l.periodStart()), ts(l.periodEnd()));
        }
        return get(id);
    }

    /**
     * A DRAFT invoice for a captured Razorpay payment. The amount Razorpay charged is
     * taken as GST-inclusive (an invoice has to add up to what was paid), split into
     * net + GST at the default rate. It stays a draft for the operator to check.
     */
    @Transactional
    public Invoice draftFromPayment(UUID paymentId, String createdBy) {
        List<Map<String, Object>> rows = jdbc.queryForList("""
                SELECT p.*, array_to_string(p.plan_keys, ', ') AS plans
                  FROM platform.payments p WHERE p.id = ?
                """, paymentId);
        if (rows.isEmpty()) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Payment not found");
        Map<String, Object> p = rows.get(0);
        String status = (String) p.get("status");
        if (!"PAID".equals(status) && !"CONSUMED".equals(status)) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "Only a captured payment (PAID or CONSUMED) can be invoiced; this one is " + status);
        }
        UUID tenantId = (UUID) p.get("tenant_id");
        if (tenantId == null) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "This payment is not attached to a workspace yet (sign-up still pending)");
        }
        Integer live = jdbc.queryForObject("""
                SELECT count(*) FROM platform.invoices WHERE payment_id = ? AND status NOT IN ('VOID', 'DISCARDED')
                """, Integer.class, paymentId);
        if (live != null && live > 0) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "This payment already has an invoice");
        }
        BigDecimal rate = defaultGstRate();
        BigDecimal gross = money((BigDecimal) p.get("amount_inr"));
        BigDecimal[] split = splitInclusive(gross, rate);
        BigDecimal net = split[0];
        Instant paidAt = ts(p, "paid_at");
        int months = p.get("period_months") instanceof Number m ? m.intValue() : 1;
        Instant periodEnd = paidAt == null ? null
                : paidAt.atZone(INDIA).plusMonths(months).toInstant();
        UUID subscriptionId = jdbc.query("""
                SELECT id FROM platform.subscriptions WHERE payment_id = ? OR razorpay_order_id = ?
                 ORDER BY created_at DESC LIMIT 1
                """, (rs, i) -> rs.getObject(1, UUID.class), paymentId, p.get("razorpay_order_id"))
                .stream().findFirst().orElse(null);

        String description = "UnifiedTree subscription: %s (%s seat%s, %s, %d month%s)".formatted(
                p.get("plans"), p.get("seats"), Integer.valueOf(1).equals(p.get("seats")) ? "" : "s",
                p.get("billing_cycle"), months, months == 1 ? "" : "s");
        // One net line; GST added by createDraft at the same rate brings it back to what was paid.
        LineInput line = new LineInput(description, null, null, BigDecimal.ONE, net, BigDecimal.ZERO, paidAt,
                periodEnd);
        Invoice draft = createDraft(new DraftInput(tenantId, null, subscriptionId, paymentId, rate, List.of(line),
                "Drafted from Razorpay payment %s. The charged amount %s is treated as GST-inclusive."
                        .formatted(p.get("razorpay_payment_id"), gross)), createdBy);
        // Tax re-derived from the rounded net can be a paisa off (Rs 49 -> 41.53 + 7.48 = 49.01). The invoice must
        // add up to what was charged, so the single line's tax is set to gross - net.
        BigDecimal diff = split[1].subtract(draft.taxTotal());
        if (diff.signum() != 0) {
            jdbc.update("""
                    UPDATE platform.invoice_lines SET tax_amount = tax_amount + ?, amount = amount + ?
                     WHERE invoice_id = ? AND line_no = 1
                    """, diff, diff, draft.id());
            jdbc.update("""
                    UPDATE platform.invoices SET tax_total = tax_total + ?, total = total + ?, updated_at = now()
                     WHERE id = ? AND status = 'DRAFT'
                    """, diff, diff, draft.id());
            draft = get(draft.id());
        }
        return draft;
    }

    // ── Issue / void ────────────────────────────────────────────────────────

    @Transactional
    public Invoice issue(UUID id) {
        // Lock the draft first: two concurrent issues must not both take a number
        jdbc.query("SELECT id FROM platform.invoices WHERE id = ? FOR UPDATE", (rs, i) -> rs.getObject(1), id);
        Invoice inv = get(id);
        if (!"DRAFT".equals(inv.status())) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "Only a draft can be issued; this is " + inv.status());
        }
        Map<String, Object> settings = jdbc.queryForMap("SELECT * FROM platform.billing_settings WHERE id = 1");
        List<String> missing = new ArrayList<>();
        if (blank(settings.get("seller_legal_name"))) missing.add("legal name");
        if (blank(settings.get("seller_gstin"))) missing.add("GSTIN");
        if (blank(settings.get("seller_state_code"))) missing.add("state code");
        if (!missing.isEmpty()) {
            // An issued invoice is frozen, so it must not go out without the seller's GST details
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "Fill in the seller's " + String.join(", ", missing) + " in billing settings before issuing");
        }
        Instant issuedAt = jdbc.queryForObject("SELECT now()", Timestamp.class).toInstant();
        String series = (String) settings.get("invoice_prefix") + "/" + financialYear(issuedAt);
        Long next = jdbc.queryForObject("""
                INSERT INTO platform.invoice_number_series (series_key, last_number) VALUES (?, 1)
                ON CONFLICT (series_key) DO UPDATE
                   SET last_number = platform.invoice_number_series.last_number + 1, updated_at = now()
                RETURNING last_number
                """, Long.class, series);
        String number = invoiceNumber(series, next);
        int dueDays = settings.get("invoice_due_days") instanceof Number d ? d.intValue() : 7;

        Map<String, Object> snapshot = new LinkedHashMap<>();
        snapshot.put("seller", seller(settings));
        snapshot.put("buyer", buyer(inv.tenantId(), inv.companyId()));
        snapshot.put("issuedAt", issuedAt.toString());
        String snapshotJson;
        try {
            snapshotJson = json.writeValueAsString(snapshot);
        } catch (Exception e) {
            throw new IllegalStateException("Could not serialise the billing snapshot", e);
        }

        // Paid already? An invoice drafted from a captured payment is issued as PAID.
        Map<String, Object> paid = inv.paymentId() == null ? null : jdbc.queryForList("""
                SELECT paid_at FROM platform.payments WHERE id = ? AND status IN ('PAID','CONSUMED')
                """, inv.paymentId()).stream().findFirst().orElse(null);
        Timestamp paidAt = paid == null ? null : (Timestamp) paid.get("paid_at");

        int updated = jdbc.update("""
                UPDATE platform.invoices
                   SET status = ?, invoice_number = ?, issued_at = ?, due_at = ?, billing_snapshot = ?::jsonb,
                       amount_paid = CASE WHEN ? THEN total ELSE amount_paid END,
                       paid_at = ?, updated_at = now()
                 WHERE id = ? AND status = 'DRAFT'
                """, paid == null ? "ISSUED" : "PAID", number, Timestamp.from(issuedAt),
                Timestamp.from(issuedAt.atZone(INDIA).plusDays(dueDays).toInstant()), snapshotJson,
                paid != null, paid == null ? null : (paidAt == null ? Timestamp.from(issuedAt) : paidAt), id);
        if (updated != 1) {
            // Rolls back this transaction, including the series number taken above
            throw new ResponseStatusException(HttpStatus.CONFLICT, "This invoice was issued by someone else just now");
        }
        return get(id);
    }

    @Transactional
    public Invoice voidInvoice(UUID id, String reason) {
        if (reason == null || reason.strip().length() < 5) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "Voiding needs a reason of at least 5 characters (it stays on the invoice)");
        }
        Invoice inv = get(id);
        if ("DRAFT".equals(inv.status())) {
            // A draft has no number yet: it is discarded (kept on record with the reason), which also frees its
            // payment for a corrected draft
            int discarded = jdbc.update("""
                    UPDATE platform.invoices SET status = 'DISCARDED', voided_at = now(), void_reason = ?, updated_at = now()
                     WHERE id = ? AND status = 'DRAFT'
                    """, reason.strip(), id);
            if (discarded != 1) throw new ResponseStatusException(HttpStatus.CONFLICT, "This draft changed just now");
            return get(id);
        }
        if (!"ISSUED".equals(inv.status()) && !"PAID".equals(inv.status())) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "Only a draft, issued or paid invoice can be voided; this is " + inv.status());
        }
        int voided = jdbc.update("""
                UPDATE platform.invoices SET status = 'VOID', voided_at = now(), void_reason = ?, updated_at = now()
                 WHERE id = ? AND status IN ('ISSUED', 'PAID')
                """, reason.strip(), id);
        if (voided != 1) throw new ResponseStatusException(HttpStatus.CONFLICT, "This invoice changed just now");
        return get(id);
    }

    // ── helpers ─────────────────────────────────────────────────────────────

    /** GST Rule 46(b): an invoice serial number is at most 16 characters (letters, digits, '-' and '/'). */
    static final int MAX_INVOICE_NUMBER_LENGTH = 16;

    /** Indian financial year label for an instant, short form: April–March, e.g. 26-27. */
    static String financialYear(Instant at) {
        LocalDate d = at.atZone(INDIA).toLocalDate();
        int start = d.getMonthValue() >= 4 ? d.getYear() : d.getYear() - 1;
        return "%02d-%02d".formatted(start % 100, (start + 1) % 100);
    }

    /** {@code PREFIX/26-27/00001}: at most 16 characters with a prefix of up to 4 (validated in billing settings). */
    static String invoiceNumber(String series, long next) {
        String number = "%s/%05d".formatted(series, next);
        if (number.length() > MAX_INVOICE_NUMBER_LENGTH) {
            throw new ResponseStatusException(HttpStatus.CONFLICT,
                    "Invoice number " + number + " would exceed 16 characters (GST); shorten the invoice prefix");
        }
        return number;
    }

    /** A GST-inclusive amount split into {net, tax} so that net + tax is exactly the amount (tax = gross - net). */
    static BigDecimal[] splitInclusive(BigDecimal gross, BigDecimal ratePct) {
        BigDecimal g = money(gross);
        BigDecimal net = money(g.multiply(BigDecimal.valueOf(100))
                .divide(BigDecimal.valueOf(100).add(ratePct), 6, RoundingMode.HALF_UP));
        return new BigDecimal[] {net, g.subtract(net)};
    }

    /** A draft's payment and subscription must belong to its workspace (and company, when given). */
    private void requireOwnedReferences(DraftInput in) {
        if (in.paymentId() != null) {
            Map<String, Object> p = jdbc.queryForList("SELECT tenant_id, status FROM platform.payments WHERE id = ?",
                    in.paymentId()).stream().findFirst().orElse(null);
            if (p == null || !in.tenantId().equals(p.get("tenant_id"))) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "That payment is not this workspace's");
            }
            if (!"PAID".equals(p.get("status")) && !"CONSUMED".equals(p.get("status"))) {
                throw new ResponseStatusException(HttpStatus.CONFLICT, "Only a captured payment can be invoiced");
            }
        }
        if (in.subscriptionId() != null) {
            Map<String, Object> sub = jdbc.queryForList(
                    "SELECT tenant_id, company_id FROM platform.subscriptions WHERE id = ?", in.subscriptionId())
                    .stream().findFirst().orElse(null);
            if (sub == null || !in.tenantId().equals(sub.get("tenant_id"))
                    || (in.companyId() != null && sub.get("company_id") != null
                        && !in.companyId().equals(sub.get("company_id")))) {
                throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "That subscription is not this workspace's");
            }
        }
    }

    private static boolean blank(Object v) {
        return v == null || v.toString().isBlank();
    }

    static BigDecimal money(BigDecimal v) {
        if (v == null) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "unitPrice is required");
        return v.setScale(2, RoundingMode.HALF_UP);
    }

    private BigDecimal defaultGstRate() {
        BigDecimal r = jdbc.queryForObject("SELECT default_gst_rate_pct FROM platform.billing_settings WHERE id = 1",
                BigDecimal.class);
        return r == null ? new BigDecimal("18.00") : r;
    }

    private UUID currentPriceVersion(String planKey) {
        if (planKey == null) return null;
        return jdbc.query("""
                SELECT id FROM platform.module_plan_prices WHERE plan_key = ? AND currency = 'INR' AND valid_to IS NULL
                """, (rs, i) -> rs.getObject(1, UUID.class), planKey).stream().findFirst().orElse(null);
    }

    private Map<String, Object> seller(Map<String, Object> s) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("legalName", s.get("seller_legal_name"));
        m.put("gstin", s.get("seller_gstin"));
        m.put("pan", s.get("seller_pan"));
        m.put("address", s.get("seller_address"));
        m.put("stateCode", s.get("seller_state_code"));
        m.put("email", s.get("seller_email"));
        return m;
    }

    /**
     * Who is billed. Per field: the company's billing profile when filled, else the company itself (org.companies,
     * read under that workspace's RLS), else, for a workspace-level invoice only, the workspace's sign-up details.
     * A company's GSTIN/PAN never falls back to the workspace's (another company of the workspace may own those).
     */
    private Map<String, Object> buyer(UUID tenantId, UUID companyId) {
        Map<String, Object> m = new LinkedHashMap<>();
        Map<String, Object> t = jdbc.queryForMap("""
                SELECT display_name, subdomain, gstin, pan, address_line1, address_line2, city, state, postal_code,
                       contact_email FROM platform.tenants WHERE id = ?
                """, tenantId);
        m.put("workspace", t.get("subdomain"));
        Map<String, Object> p = companyId == null ? Map.of() : jdbc.queryForList(
                "SELECT * FROM platform.company_billing_profiles WHERE company_id = ?", companyId)
                .stream().findFirst().orElse(Map.of());
        Map<String, Object> c = companyId == null ? Map.of() : scoped.read(tenantId, () -> jdbc.queryForList(
                "SELECT name, legal_name, gstin, pan_number FROM org.companies WHERE id = ?", companyId))
                .stream().findFirst().orElse(Map.of());
        boolean company = companyId != null;
        if (company) m.put("companyId", companyId.toString());
        m.put("legalName", first(p.get("legal_name"), c.get("legal_name"), c.get("name"),
                company ? null : t.get("display_name")));
        Object gstin = first(p.get("gstin"), c.get("gstin"), company ? null : t.get("gstin"));
        m.put("gstin", gstin);
        m.put("pan", first(p.get("pan"), c.get("pan_number"), company ? null : t.get("pan")));
        m.put("email", first(p.get("billing_email"), t.get("contact_email")));
        m.put("address", p.isEmpty()
                ? join(t.get("address_line1"), t.get("address_line2"), t.get("city"), t.get("state"), t.get("postal_code"))
                : join(p.get("address_line1"), p.get("address_line2"), p.get("city"), p.get("state"), p.get("postal_code")));
        // GST place of supply: the profile's state code, else the first two digits of the GSTIN (they are the state)
        m.put("stateCode", first(p.get("state_code"), gstin == null ? null : gstin.toString().substring(0, 2)));
        return m;
    }

    private static Object first(Object... values) {
        for (Object v : values) if (v != null && !v.toString().isBlank()) return v;
        return null;
    }

    private static String join(Object... parts) {
        List<String> out = new ArrayList<>();
        for (Object p : parts) if (p != null && !p.toString().isBlank()) out.add(p.toString().strip());
        return out.isEmpty() ? null : String.join(", ", out);
    }

    private List<InvoiceLine> lines(UUID invoiceId) {
        return jdbc.query("SELECT * FROM platform.invoice_lines WHERE invoice_id = ? ORDER BY line_no",
                (rs, i) -> new InvoiceLine(rs.getObject("id", UUID.class), rs.getInt("line_no"),
                        rs.getString("plan_key"), rs.getString("module_key"),
                        rs.getObject("price_version_id", UUID.class), rs.getString("description"),
                        rs.getBigDecimal("quantity"), rs.getBigDecimal("unit_price"), rs.getBigDecimal("discount"),
                        rs.getBigDecimal("tax_rate_pct"), rs.getBigDecimal("tax_amount"), rs.getBigDecimal("amount"),
                        instant(rs, "period_start"), instant(rs, "period_end")), invoiceId);
    }

    private static String selectSql() {
        return """
                SELECT i.*, i.billing_snapshot::text AS snapshot_json, t.subdomain
                  FROM platform.invoices i JOIN platform.tenants t ON t.id = i.tenant_id
                """;
    }

    @SuppressWarnings("unchecked")
    private Invoice map(ResultSet rs, List<InvoiceLine> lines) throws SQLException {
        Map<String, Object> snapshot = null;
        String raw = rs.getString("snapshot_json");
        if (raw != null) {
            try {
                snapshot = json.readValue(raw, LinkedHashMap.class);
            } catch (Exception ignored) {
                snapshot = Map.of("unreadable", true);
            }
        }
        return new Invoice(rs.getObject("id", UUID.class), rs.getString("invoice_number"),
                rs.getObject("tenant_id", UUID.class), rs.getString("subdomain"), rs.getObject("company_id", UUID.class),
                rs.getObject("subscription_id", UUID.class), rs.getObject("payment_id", UUID.class),
                rs.getString("status"), rs.getString("currency"), rs.getBigDecimal("subtotal"),
                rs.getBigDecimal("discount_total"), rs.getBigDecimal("tax_total"), rs.getBigDecimal("total"),
                rs.getBigDecimal("amount_paid"), instant(rs, "period_start"), instant(rs, "period_end"),
                instant(rs, "issued_at"), instant(rs, "due_at"), instant(rs, "paid_at"), instant(rs, "voided_at"),
                rs.getString("void_reason"), snapshot, rs.getString("notes"), rs.getString("created_by"),
                instant(rs, "created_at"), lines);
    }

    private static Timestamp ts(Instant i) {
        return i == null ? null : Timestamp.from(i);
    }

    private static Instant ts(Map<String, Object> m, String key) {
        Object v = m.get(key);
        return v instanceof Timestamp t ? t.toInstant() : null;
    }

    private static Instant instant(ResultSet rs, String column) throws SQLException {
        Timestamp t = rs.getTimestamp(column);
        return t == null ? null : t.toInstant();
    }
}
