package com.unifiedtree.settings.branding;

import com.hrms.core.dto.ErrorResponse;
import org.junit.jupiter.api.Test;
import org.springframework.http.ResponseEntity;

import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * What the public sign-in lookup answers for each kind of address: a business (its name, images and
 * status), an unknown address, and one of UnifiedTree's own addresses (admin, marketing, ...).
 */
class PublicBrandingLookupTest {

    private final BrandingService service = mock(BrandingService.class);
    private final PublicBrandingController controller = new PublicBrandingController(service);

    @Test
    void aBusinessGetsItsBrandingAndStatus() {
        when(service.publicView("tatagroups")).thenReturn(Optional.of(
                new BrandingService.PublicView("Tata Groups", "T", null, null, null, "ACTIVE")));

        ResponseEntity<?> r = controller.lookup("tatagroups", null, null);

        assertThat(r.getStatusCode().value()).isEqualTo(200);
        BrandingService.PublicView v = (BrandingService.PublicView) r.getBody();
        assertThat(v.workspaceName()).isEqualTo("Tata Groups");
        assertThat(v.status()).isEqualTo("ACTIVE");
    }

    @Test
    void aSuspendedBusinessSaysSo() {
        when(service.publicView("acme")).thenReturn(Optional.of(
                new BrandingService.PublicView("Acme", "A", null, null, null, "SUSPENDED")));

        BrandingService.PublicView v = (BrandingService.PublicView) controller.lookup("acme", null, null).getBody();

        assertThat(v.status()).isEqualTo("SUSPENDED");
    }

    @Test
    void anUnknownAddressIsNotFound() {
        when(service.publicView(anyString())).thenReturn(Optional.empty());

        ResponseEntity<?> r = controller.lookup("tata", null, null);

        assertThat(r.getStatusCode().value()).isEqualTo(404);
        ErrorResponse e = (ErrorResponse) r.getBody();
        assertThat(e.errorCode()).isEqualTo("WORKSPACE_NOT_FOUND");
        // Same message as before the code existed, so an older web app reads it the same way.
        assertThat(e.message()).isEqualTo("Workspace not found");
        assertThat(r.getHeaders().getCacheControl()).contains("no-store");
    }

    @Test
    void unifiedTreesOwnAddressesAreReservedNotABusiness() {
        when(service.publicView(anyString())).thenReturn(Optional.empty());

        for (String host : new String[]{"admin", "marketing", "business", "app", "www", "mail"}) {
            ResponseEntity<?> r = controller.lookup(host, null, null);
            assertThat(r.getStatusCode().value()).as(host).isEqualTo(404);
            assertThat(((ErrorResponse) r.getBody()).errorCode()).as(host).isEqualTo("WORKSPACE_RESERVED");
        }
    }

    @Test
    void aBusinessThatAlreadyHoldsAReservedNameKeepsWorking() {
        // e.g. the local "demo" business, created before "demo" was reserved for sign-up.
        when(service.publicView("demo")).thenReturn(Optional.of(
                new BrandingService.PublicView("UnifiedTree Demo", "U", null, null, null, "ACTIVE")));

        assertThat(controller.lookup("demo", null, null).getStatusCode().value()).isEqualTo(200);
    }
}
