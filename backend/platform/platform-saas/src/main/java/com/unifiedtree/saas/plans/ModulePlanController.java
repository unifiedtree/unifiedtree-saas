package com.unifiedtree.saas.plans;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * Public, unauthenticated catalog of sellable plans for the marketing website.
 * Mounted under /v1/public so CanonicalProdSecurityConfig's permitAll lets
 * anonymous traffic read it. Replaces the hardcoded website data/modules.ts.
 */
@RestController
@RequestMapping("/v1/public")
public class ModulePlanController {

    private final ModulePlanService plans;

    public ModulePlanController(ModulePlanService plans) {
        this.plans = plans;
    }

    @GetMapping("/module-plans")
    public List<ModulePlanDto> listPlans() {
        return plans.listPlans();
    }
}
