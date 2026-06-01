package com.hrms.app;

import com.hrms.core.crypto.FieldEncryptor;
import com.unifiedtree.auth.service.JwtService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.RestClient;

import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

/**
 * Shared helpers for canonical integration tests. Subclasses supply all
 * Spring and container annotations; this class contributes only runtime
 * convenience methods injected via the subclass's Spring context.
 */
public abstract class AbstractIntegrationTest {

    // Force Testcontainers to use Docker Desktop's TCP endpoint (2375) rather
    // than the named-pipe proxy, which Docker Desktop 4.35+ blocks for non-CLI clients.
    // Docker Desktop 4.73+ requires API >= 1.40; docker-java defaults to 1.24 which returns 400.
    static {
        if (System.getProperty("DOCKER_HOST") == null) {
            System.setProperty("DOCKER_HOST", "tcp://127.0.0.1:2375");
        }
        if (System.getProperty("api.version") == null) {
            System.setProperty("api.version", "1.44");
        }
    }

    protected static final UUID TENANT_A = UUID.fromString("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    protected static final UUID TENANT_B = UUID.fromString("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");

    @LocalServerPort
    protected int port;

    @Autowired
    protected JdbcTemplate jdbc;

    @Autowired
    protected JwtService jwtService;

    @Autowired
    protected FieldEncryptor fieldEncryptor;

    @Autowired
    private PlatformTransactionManager txManager;

    protected RestClient http() {
        return RestClient.builder()
            .baseUrl("http://localhost:" + port + "/api")
            .build();
    }

    /** POST /v1/canonical-auth/login and return the full response map. */
    protected Map<?, ?> login(UUID tenantId, String email, String password) {
        Map<String, Object> body = new HashMap<>();
        body.put("tenantId", tenantId.toString());
        body.put("email", email);
        body.put("password", password);
        return http().post()
            .uri("/v1/canonical-auth/login")
            .contentType(MediaType.APPLICATION_JSON)
            .body(body)
            .retrieve()
            .body(Map.class);
    }

    /**
     * Runs {@code block} inside a Spring-managed transaction on the hrms_app
     * (non-superuser) role with the tenant context set.
     *
     * Using TransactionTemplate ensures every jdbc call in the block shares the
     * same physical connection, so SET LOCAL settings persist. The hrms_app role
     * is required because PostgreSQL superusers bypass RLS even with FORCE ROW
     * LEVEL SECURITY; dropping to hrms_app ensures tenant_isolation policies fire.
     */
    protected void withTenantJdbc(UUID tenantId, Runnable block) {
        new TransactionTemplate(txManager).execute(status -> {
            jdbc.execute("SET LOCAL ROLE hrms_app");
            jdbc.execute("SET LOCAL app.tenant_id = '" + tenantId + "'");
            block.run();
            return null;
        });
    }

    /**
     * Runs {@code r} and returns the first {@link HttpClientErrorException} it
     * throws. Fails the test with an {@link AssertionError} if no exception is
     * thrown.
     */
    protected HttpClientErrorException expectError(Runnable r) {
        try {
            r.run();
        } catch (HttpClientErrorException e) {
            return e;
        } catch (RuntimeException e) {
            if (e.getCause() instanceof HttpClientErrorException hcee) return hcee;
            throw e;
        }
        throw new AssertionError("expected HTTP 4xx error but request succeeded");
    }
}
