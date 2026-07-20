package com.unifiedtree.saas.plans;

import java.math.BigDecimal;
import java.util.List;

/**
 * Wire shape for one sellable plan on the website pricing page. Served by
 * GET /v1/public/module-plans so the frontend never hardcodes modules/prices.
 */
public record ModulePlanDto(
        String key,
        String displayName,
        String tagline,
        String description,
        String category,
        String icon,
        String color,
        BigDecimal priceInr,      // monthly price PER SEAT (per user) when priceModel = PER_SEAT
        String priceModel,        // PER_SEAT | FLAT
        String status,            // AVAILABLE | LAUNCHING_SOON | RETIRED
        int sortOrder,
        List<String> features,
        List<String> includedModules
) {}
