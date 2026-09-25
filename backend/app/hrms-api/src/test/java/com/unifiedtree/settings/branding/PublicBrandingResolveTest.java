package com.unifiedtree.settings.branding;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

/** Which workspace the public sign-in branding lookup answers for. */
class PublicBrandingResolveTest {

    @Test void theQueryParameterWinsOverHeaderAndHost() {
        assertEquals("acme", PublicBrandingController.resolve("Acme", "beta", "gamma.example.com"));
    }

    @Test void theHeaderIsUsedWithoutAParameter() {
        assertEquals("beta", PublicBrandingController.resolve(null, " beta ", "gamma.example.com"));
    }

    @Test void theHostIsTheLastResortButNeverTheApiOrWwwHost() {
        assertEquals("gamma", PublicBrandingController.resolve(null, null, "gamma.example.com:443"));
        assertNull(PublicBrandingController.resolve(null, null, "api.example.com"));
        assertNull(PublicBrandingController.resolve(null, null, "www.example.com"));
        assertNull(PublicBrandingController.resolve(null, null, "localhost"));
    }

    @Test void anythingThatIsNotASlugIsRefused() {
        assertNull(PublicBrandingController.resolve("a b", null, null));
        assertNull(PublicBrandingController.resolve("x'; drop table", null, null));
        assertNull(PublicBrandingController.resolve(null, null, null));
    }
}
