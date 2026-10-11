package com.hrms.app.roster;

import com.hrms.api.roster.RosterPilot;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.config.YamlPropertiesFactoryBean;
import org.springframework.core.env.MapPropertySource;
import org.springframework.core.env.PropertiesPropertySource;
import org.springframework.core.env.StandardEnvironment;
import org.springframework.core.io.ClassPathResource;

import java.util.Map;
import java.util.Properties;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Where shift planning's pilot list comes from: {@code unifiedtree.roster.pilot-tenants} in application.yml, read
 * from the environment variable {@code UNIFIEDTREE_ROSTER_PILOT_TENANTS}, else the test businesses (the same list
 * as {@link RosterPilot#DEFAULT_TENANTS}, so the two can't drift apart).
 */
class RosterPilotConfigTest {

    private static Properties applicationYml() {
        YamlPropertiesFactoryBean yaml = new YamlPropertiesFactoryBean();
        yaml.setResources(new ClassPathResource("application.yml"));
        return yaml.getObject();
    }

    private static String resolved(Map<String, Object> environment) {
        StandardEnvironment env = new StandardEnvironment();
        // only the variables given here, not this machine's
        env.getPropertySources().remove(StandardEnvironment.SYSTEM_ENVIRONMENT_PROPERTY_SOURCE_NAME);
        env.getPropertySources().remove(StandardEnvironment.SYSTEM_PROPERTIES_PROPERTY_SOURCE_NAME);
        env.getPropertySources().addFirst(new MapPropertySource("os", environment));
        env.getPropertySources().addLast(new PropertiesPropertySource("application.yml", applicationYml()));
        return env.getProperty("unifiedtree.roster.pilot-tenants");
    }

    @Test
    void theListIsReadFromTheEnvironmentWithTheTestBusinessesAsTheDefault() {
        assertThat(applicationYml().getProperty("unifiedtree.roster.pilot-tenants"))
                .isEqualTo("${UNIFIEDTREE_ROSTER_PILOT_TENANTS:" + RosterPilot.DEFAULT_TENANTS + "}");
    }

    @Test
    void withoutTheVariableTheTestBusinessesAreOn() {
        assertThat(resolved(Map.of())).isEqualTo(RosterPilot.DEFAULT_TENANTS);
    }

    @Test
    void theVariableReplacesTheList() {
        assertThat(resolved(Map.of("UNIFIEDTREE_ROSTER_PILOT_TENANTS", " Demo , SRI ,"))).isEqualTo(" Demo , SRI ,");
        assertThat(new RosterPilot(null, resolved(Map.of("UNIFIEDTREE_ROSTER_PILOT_TENANTS", " Demo , SRI ,"))).subdomains())
                .containsExactly("demo", "sri");
        assertThat(new RosterPilot(null, resolved(Map.of("UNIFIEDTREE_ROSTER_PILOT_TENANTS", ""))).subdomains()).isEmpty();
    }
}
