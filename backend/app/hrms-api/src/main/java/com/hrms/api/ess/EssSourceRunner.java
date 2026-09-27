package com.hrms.api.ess;

import com.hrms.api.saasguard.TenantModuleLookup;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionOperations;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Function;

/**
 * Runs the sources of a Home list for one caller.
 *
 * <ul>
 *   <li>A source the caller may not see ({@link EssSource#allowed}) is skipped
 *       silently: it is not theirs to know about.</li>
 *   <li>A source whose module is off for the workspace is skipped too, exactly
 *       as its own endpoints are refused ({@code TenantModuleGuard}).</li>
 *   <li>Every other source runs in its own read-only transaction. PostgreSQL
 *       aborts a whole transaction on any error, so this is what keeps one
 *       failing source (including {@code FEATURE_NOT_READY} for a table that
 *       isn't there yet) from taking the others down. It is logged and its key
 *       reported in {@code unavailable}; the rest still answer.</li>
 * </ul>
 * The same pattern as the top bar's search (GlobalSearchService).
 */
@Component
public class EssSourceRunner {

    private static final Logger log = LoggerFactory.getLogger(EssSourceRunner.class);
    /** The platform operator's own tenant: no workspace modules to check (TenantModuleGuard skips it too). */
    private static final UUID PLATFORM_TENANT_ID = UUID.fromString("00000000-0000-0000-0000-000000000000");

    private final TenantModuleLookup modules;
    private final TransactionOperations tx;

    @Autowired
    public EssSourceRunner(TenantModuleLookup modules, PlatformTransactionManager txManager) {
        this(modules, readOnlyNewTransaction(txManager));
    }

    /** With the given transaction handling (tests use {@code TransactionOperations.withoutTransaction()}). */
    public EssSourceRunner(TenantModuleLookup modules, TransactionOperations tx) {
        this.modules = modules;
        this.tx = tx;
    }

    private static TransactionTemplate readOnlyNewTransaction(PlatformTransactionManager txManager) {
        TransactionTemplate t = new TransactionTemplate(txManager);
        t.setReadOnly(true);
        t.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        return t;
    }

    /** What a list gathered: the items, the sources that answered, and the ones that failed. */
    public record Collected<T>(List<T> items, List<String> included, List<String> unavailable) {}

    /**
     * Runs {@code load} for each source the caller may see, in key order.
     * Nothing runs for a caller without an employee record unless
     * {@code needsEmployee} is false.
     */
    public <S extends EssSource, T> Collected<T> collect(EssCaller caller, List<S> sources, boolean needsEmployee,
                                                          Function<S, List<T>> load) {
        List<T> items = new ArrayList<>();
        List<String> included = new ArrayList<>();
        List<String> unavailable = new ArrayList<>();
        if (caller.tenantId() == null || (needsEmployee && !caller.hasEmployee())) {
            return new Collected<>(items, included, unavailable);
        }
        Map<String, Boolean> moduleOn = new HashMap<>();
        List<S> ordered = new ArrayList<>(sources);
        ordered.sort(Comparator.comparing(EssSource::key));
        for (S source : ordered) {
            if (!source.allowed(caller)) continue;
            try {
                String module = source.module();
                if (module != null && !moduleOn.computeIfAbsent(module, m -> moduleActive(caller.tenantId(), m))) continue;
                List<T> got = tx.execute(status -> load.apply(source));
                if (got != null) items.addAll(got);
                included.add(source.key());
            } catch (RuntimeException e) {
                log.warn("Self-service Home: source {} failed for tenant {}: {}", source.key(), caller.tenantId(), e.toString());
                unavailable.add(source.key());
            }
        }
        return new Collected<>(items, included, unavailable);
    }

    private boolean moduleActive(UUID tenantId, String module) {
        return PLATFORM_TENANT_ID.equals(tenantId) || modules.hasActiveModule(tenantId, module);
    }
}
