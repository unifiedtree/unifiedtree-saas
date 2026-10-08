package com.unifiedtree.auth.ratelimit;

import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;

import static org.assertj.core.api.Assertions.assertThat;

/** Review 7 Oct: rate limits key on the hop Google's front end appended, not one the caller can write. */
class ClientIpTest {

    @Test
    void theLastHopIsTheOneGoogleWrote() {
        MockHttpServletRequest req = new MockHttpServletRequest();
        req.addHeader("X-Forwarded-For", "1.2.3.4, 203.0.113.7");   // "1.2.3.4" was sent by the caller
        assertThat(ClientIp.of(req)).isEqualTo("203.0.113.7");
    }

    @Test
    void withoutTheHeaderTheSocketAddress() {
        MockHttpServletRequest req = new MockHttpServletRequest();
        req.setRemoteAddr("10.0.0.9");
        assertThat(ClientIp.of(req)).isEqualTo("10.0.0.9");
    }

    @Test
    void aNumberIsLimitedHoweverItIsWritten() {
        assertThat(ClientIp.phoneKey("+91 98765 43210")).isEqualTo(ClientIp.phoneKey("9876543210")).isEqualTo("9876543210");
    }
}
