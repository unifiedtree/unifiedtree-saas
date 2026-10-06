package com.unifiedtree.rbac.company;

import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.core.MethodParameter;
import org.springframework.http.HttpInputMessage;
import org.springframework.http.converter.HttpMessageConverter;
import org.springframework.web.bind.annotation.ControllerAdvice;
import org.springframework.web.servlet.mvc.method.annotation.RequestBodyAdviceAdapter;

import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.lang.reflect.Type;
import java.util.Collection;
import java.util.LinkedHashSet;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

/**
 * Company access for request BODIES (docs/redesign/COMPANY_ACCESS.md): once a
 * JSON body is read, every {@code companyId} it carries goes through
 * {@link CompanyAccessService#checkBodyCompany(UUID)} — one check for every
 * create and update (employees, departments, designations, shifts, leave types,
 * holidays, payroll runs, policies, onboarding, hiring, …) instead of a copy
 * in each controller.
 *
 * <p>Read: the body's own {@code companyId} (a record component, a
 * {@code getCompanyId()} getter, a map key or a JSON field; a UUID or a UUID
 * string), and the same for each item of a list body. Nested objects are not
 * looked into. A value that is not a UUID is left for the endpoint to reject.
 * Runs before the controller method (and so before its {@code @PreAuthorize}).
 */
@ControllerAdvice
public class CompanyBodyAccessAdvice extends RequestBodyAdviceAdapter {

    static final String FIELD = "companyId";
    /** A list body is checked item by item up to this many items (bulk endpoints cap their own size). */
    static final int MAX_ITEMS = 5_000;

    private static final ClassValue<Optional<Method>> ACCESSOR = new ClassValue<>() {
        @Override
        protected Optional<Method> computeValue(Class<?> type) {
            return Optional.ofNullable(findAccessor(type));
        }
    };

    private final CompanyAccessService access;

    public CompanyBodyAccessAdvice(CompanyAccessService access) {
        this.access = access;
    }

    @Override
    public boolean supports(MethodParameter parameter, Type targetType,
                            Class<? extends HttpMessageConverter<?>> converterType) {
        return access.enforced();
    }

    @Override
    public Object afterBodyRead(Object body, HttpInputMessage inputMessage, MethodParameter parameter,
                                Type targetType, Class<? extends HttpMessageConverter<?>> converterType) {
        for (UUID companyId : companies(body)) access.checkBodyCompany(companyId);
        return body;
    }

    /** The company ids a body carries at its top level (or at the top level of each list item). */
    static Set<UUID> companies(Object body) {
        Set<UUID> out = new LinkedHashSet<>();
        if (body instanceof Collection<?> items) {
            int n = 0;
            for (Object item : items) {
                if (n++ >= MAX_ITEMS) break;
                add(out, companyOf(item));
            }
        } else if (body instanceof Object[] items) {
            for (int i = 0; i < items.length && i < MAX_ITEMS; i++) add(out, companyOf(items[i]));
        } else if (body instanceof JsonNode node && node.isArray()) {
            int n = 0;
            for (JsonNode item : node) {
                if (n++ >= MAX_ITEMS) break;
                add(out, companyOf(item));
            }
        } else {
            add(out, companyOf(body));
        }
        return out;
    }

    private static void add(Set<UUID> out, UUID id) {
        if (id != null) out.add(id);
    }

    /** One object's own {@code companyId}, or null. */
    static UUID companyOf(Object item) {
        if (item == null) return null;
        if (item instanceof Map<?, ?> map) return toUuid(map.get(FIELD));
        if (item instanceof JsonNode node) {
            JsonNode v = node.isObject() ? node.get(FIELD) : null;
            return v != null && v.isTextual() ? toUuid(v.asText()) : null;
        }
        Method m = ACCESSOR.get(item.getClass()).orElse(null);
        if (m == null) return null;
        try {
            return toUuid(m.invoke(item));
        } catch (ReflectiveOperationException | RuntimeException e) {
            return null;
        }
    }

    /** {@code companyId()} or {@code getCompanyId()} returning a UUID or String, on our own types only. */
    private static Method findAccessor(Class<?> type) {
        String pkg = type.getPackageName();
        if (!pkg.startsWith("com.hrms") && !pkg.startsWith("com.unifiedtree")) return null;
        for (String name : new String[] {FIELD, "getCompanyId"}) {
            try {
                Method m = type.getMethod(name);
                Class<?> r = m.getReturnType();
                if (Modifier.isStatic(m.getModifiers()) || (r != UUID.class && r != String.class)) continue;
                m.setAccessible(true);  // public method of a non-public (nested) type
                return m;
            } catch (NoSuchMethodException | RuntimeException ignored) {
                // try the next name
            }
        }
        return null;
    }

    private static UUID toUuid(Object v) {
        if (v instanceof UUID u) return u;
        if (v instanceof String s && !s.isBlank()) {
            try {
                return UUID.fromString(s.trim());
            } catch (IllegalArgumentException notAUuid) {
                return null;
            }
        }
        return null;
    }
}
