package com.hrms.app.config;

import io.swagger.v3.oas.models.Components;
import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.info.Contact;
import io.swagger.v3.oas.models.info.Info;
import io.swagger.v3.oas.models.security.SecurityRequirement;
import io.swagger.v3.oas.models.security.SecurityScheme;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class OpenApiConfig {

    @Bean
    public OpenAPI hrmsOpenApi() {
        return new OpenAPI()
                .info(new Info()
                        .title("HRMS Platform API")
                        .description("Multi-tenant enterprise HRMS - 5 role UIs, face attendance, real-time dashboards")
                        .version("v1.0.0")
                        .contact(new Contact().name("HRMS Platform")))
                .addSecurityItem(new SecurityRequirement().addList("bearerAuth"))
                .components(new Components()
                        .addSecuritySchemes("bearerAuth", new SecurityScheme()
                                .name("bearerAuth")
                                .type(SecurityScheme.Type.HTTP)
                                .scheme("bearer")
                                .bearerFormat("JWT")
                                .description("RS256-signed JWT. Obtain from POST /api/v1/auth/login")));
    }
}
