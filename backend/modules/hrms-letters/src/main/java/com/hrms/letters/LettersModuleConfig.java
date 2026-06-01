package com.hrms.letters;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.ComponentScan;
import org.springframework.context.annotation.Configuration;

@Configuration
@ComponentScan(basePackages = "com.hrms.letters")
@EnableConfigurationProperties(LettersModuleConfig.LettersProperties.class)
public class LettersModuleConfig {

    @ConfigurationProperties(prefix = "unifiedtree.letters")
    public record LettersProperties(
            String localPath,
            String fromEmail,
            String fromName
    ) {
        public LettersProperties {
            if (localPath == null || localPath.isBlank()) {
                localPath = System.getProperty("java.io.tmpdir") + "/unifiedtree/letters";
            }
            if (fromEmail == null || fromEmail.isBlank()) {
                fromEmail = "noreply@unifiedtree.io";
            }
            if (fromName == null || fromName.isBlank()) {
                fromName = "UnifiedTree HRMS";
            }
        }
    }
}
