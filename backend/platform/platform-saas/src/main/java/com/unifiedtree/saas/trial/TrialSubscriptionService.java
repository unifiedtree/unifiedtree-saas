package com.unifiedtree.saas.trial;

import com.unifiedtree.saas.plans.ModulePlanDto;
import com.unifiedtree.saas.plans.ModulePlanService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

/**
 * Creates the durable {@code platform.subscriptions} row for a TRIAL signup.
 * Parallels {@link com.unifiedtree.saas.payment.PaymentService#markConsumed}
 * but without any Razorpay identifiers or amounts — the trial is free.
 *
 * <p>The trial covers every plan the caller asked for, at whatever the plan's
 * catalog price is (for reporting only — we insert {@code amount_inr = 0}).
 * When the daily {@code TrialLifecycleJob} finds this row past its period
 * end, it flips status to {@code EXPIRED} and fires notifications; the
 * workspace itself keeps working (no gating).
 */
@Service
public class TrialSubscriptionService {

    private static final Logger log = LoggerFactory.getLogger(TrialSubscriptionService.class);

    private final JdbcTemplate jdbc;
    private final ModulePlanService planService;
    private final BillingSettingsService billingSettings;

    public TrialSubscriptionService(JdbcTemplate jdbc,
                                    ModulePlanService planService,
                                    BillingSettingsService billingSettings) {
        this.jdbc = jdbc;
        this.planService = planService;
        this.billingSettings = billingSettings;
    }

    /**
     * Insert a TRIAL subscription lasting {@code billing_settings.trial_days}
     * from now. Returns the subscription id.
     *
     * @param tenantId    workspace being trialed
     * @param subdomain   subdomain of the workspace (for the ledger)
     * @param email       admin contact email
     * @param planKeys    module_plans keys the trial covers (AVAILABLE plans)
     * @param seats       team size the buyer intends (informational)
     */
    public UUID createTrial(UUID tenantId,
                            String subdomain,
                            String email,
                            List<String> planKeys,
                            int seats) {
        BillingSettings s = billingSettings.current();
        if (!s.trialEnabled()) {
            throw new IllegalStateException("Trials are disabled (platform.billing_settings.trial_enabled=false)");
        }
        int billedSeats = Math.max(1, seats);
        int trialDays = s.trialDays();

        List<ModulePlanDto> plans = planService.requireAvailable(planKeys);
        List<String> modules = planService.expandModules(plans);
        BigDecimal unitPrice = plans.stream()
                .map(p -> p.priceInr() == null ? BigDecimal.ZERO : p.priceInr())
                .reduce(BigDecimal.ZERO, BigDecimal::add);
        List<String> normKeys = plans.stream().map(ModulePlanDto::key).toList();

        UUID subscriptionId = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO platform.subscriptions
                    (id, tenant_id, subdomain, contact_email, plan_keys, modules, seats,
                     billing_cycle, unit_price_inr, amount_inr, currency, status,
                     plan_type, current_period_start, current_period_end,
                     created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, 'MONTHLY', ?, 0, 'INR', 'ACTIVE',
                        'TRIAL', now(), now() + make_interval(days => ?),
                        now(), now())
                """,
                subscriptionId, tenantId,
                subdomain == null ? null : subdomain.trim().toLowerCase(Locale.ROOT),
                email == null ? null : email.trim().toLowerCase(Locale.ROOT),
                normKeys.toArray(new String[0]),
                modules.toArray(new String[0]),
                billedSeats, unitPrice, trialDays);

        log.info("TRIAL subscription {} started for tenant {} ({} days, plans={})",
                subscriptionId, tenantId, trialDays, normKeys);
        return subscriptionId;
    }
}
