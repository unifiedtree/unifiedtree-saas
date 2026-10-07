package com.unifiedtree.saas.oauth;

import com.unifiedtree.auth.mfa.MfaService;
import com.unifiedtree.auth.ratelimit.PublicEndpointRateLimiter;
import com.unifiedtree.auth.service.AuthService;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/** "Continue with Google" (?business=) goes to Google only for an open business. */
class GoogleBusinessStartTest {

    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
    private final GoogleOauthService oauth = mock(GoogleOauthService.class);
    private final BusinessGoogleSignIn business =
            new BusinessGoogleSignIn(jdbc, mock(AuthService.class), mock(MfaService.class), "https://{sub}.unifiedtree.com");
    private final GoogleOauthController controller =
            new GoogleOauthController(oauth, mock(PublicEndpointRateLimiter.class), business);

    @Test
    void anUnknownOrReservedBusinessIsRefusedBeforeGoogle() throws Exception {
        when(jdbc.queryForList(contains("FROM platform.tenants"), eq(UUID.class), anyString())).thenReturn(List.of());

        for (String sub : new String[]{"tata", "admin", "marketing"}) {
            MockHttpServletResponse res = new MockHttpServletResponse();
            controller.start(null, null, sub, new MockHttpServletRequest(), res);
            assertThat(res.getStatus()).as(sub).isEqualTo(400);
            assertThat(res.getContentAsString()).as(sub).contains("business_invalid");
        }
        verifyNoInteractions(oauth);
    }

    @Test
    void isOpenOnlyForAnActiveBusiness() {
        UUID acme = UUID.randomUUID();
        when(jdbc.queryForList(contains("status = 'ACTIVE'"), eq(UUID.class), eq("acme"))).thenReturn(List.of(acme));
        when(jdbc.queryForList(contains("status = 'ACTIVE'"), eq(UUID.class), eq("tata"))).thenReturn(List.of());

        assertThat(business.isOpen("acme")).isTrue();
        assertThat(business.isOpen("tata")).isFalse();
        assertThat(business.isOpen(null)).isFalse();
    }
}
