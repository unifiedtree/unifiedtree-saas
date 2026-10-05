package com.hrms.api;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.config.BeanDefinition;
import org.springframework.context.annotation.ClassPathScanningCandidateComponentProvider;
import org.springframework.core.type.filter.AnnotationTypeFilter;
import org.springframework.stereotype.Component;

import java.lang.reflect.Constructor;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Every Spring component must leave Spring one constructor to use.
 *
 * <p>A component with two constructors and no {@code @Autowired} on either (and
 * no no-argument one) compiles and passes its unit tests, which build it by
 * hand, but stops the whole app at start-up ("No default constructor found").
 * That took down a deploy on 2026-10-05 (CelebrationsService); this catches it
 * before a deploy instead.
 */
class SpringConstructorChoiceTest {

    @Test
    void everyComponentHasAConstructorSpringCanChoose() throws Exception {
        ClassPathScanningCandidateComponentProvider scanner = new ClassPathScanningCandidateComponentProvider(false);
        scanner.addIncludeFilter(new AnnotationTypeFilter(Component.class));

        List<String> ambiguous = new ArrayList<>();
        for (BeanDefinition def : scanner.findCandidateComponents("com.hrms")) {
            Class<?> type = Class.forName(def.getBeanClassName(), false, getClass().getClassLoader());
            Constructor<?>[] ctors = Arrays.stream(type.getDeclaredConstructors())
                    .filter(c -> !c.isSynthetic())
                    .toArray(Constructor<?>[]::new);
            if (ctors.length < 2) continue;
            boolean marked = Arrays.stream(ctors).anyMatch(c -> c.isAnnotationPresent(Autowired.class));
            boolean noArg = Arrays.stream(ctors).anyMatch(c -> c.getParameterCount() == 0);
            if (!marked && !noArg) ambiguous.add(type.getName());
        }
        assertTrue(ambiguous.isEmpty(),
                "Mark the constructor Spring should use with @Autowired in: " + ambiguous);
    }
}
