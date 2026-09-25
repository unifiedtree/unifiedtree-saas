package com.unifiedtree.settings.branding;

import com.unifiedtree.settings.branding.BrandingImage.Kind;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.ResultSetExtractor;
import org.springframework.web.server.ResponseStatusException;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;

/**
 * BrandingService write path without a database: a recording JdbcTemplate
 * and an unconfigured R2 (the local / staging case, where the database copy
 * is the only one and must still work end to end).
 */
class BrandingServiceStoreTest {

    /** Records every update; every query returns null (no row yet). */
    static final class RecordingJdbc extends JdbcTemplate {
        final List<String> sql = new ArrayList<>();
        final List<Object[]> args = new ArrayList<>();
        @Override public int update(String s, Object... a) { sql.add(s); args.add(a); return 1; }
        @Override public <T> T query(String s, ResultSetExtractor<T> rse, Object... a) { return null; }
    }

    static R2Storage noR2() {
        return new R2Storage("", "", "", "", "");
    }

    static final UUID TENANT = UUID.fromString("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    static final UUID ACTOR = UUID.randomUUID();

    @Test void storesTheCheckedBytesSizeTypeAndAVersionedPublicAddress() throws Exception {
        var jdbc = new RecordingJdbc();
        var svc = new BrandingService(jdbc, noR2());
        byte[] mark = BrandingImageTest.png(256, 256);

        svc.store(TENANT, ACTOR, Kind.MARK, mark);

        assertEquals(1, jdbc.sql.size());
        String sql = jdbc.sql.get(0);
        assertTrue(sql.startsWith("INSERT INTO platform.tenant_branding"), sql);
        assertTrue(sql.contains("mark_bytes") && !sql.contains("logo_bytes"), "only the mark columns are written");
        Object[] a = jdbc.args.get(0);
        String version = BrandingService.sha(mark);
        assertEquals(TENANT, a[0]);
        assertEquals("/v1/public/workspace-branding/" + TENANT + "/mark?v=" + version, a[1]);
        assertNull(a[2], "no R2 key when R2 is not configured");
        assertArrayEquals(mark, (byte[]) a[3]);
        assertEquals("image/png", a[4]);
        assertEquals(256, a[5]);
        assertEquals(256, a[6]);
        assertEquals(version, a[7]);
        assertEquals(16, version.length());
        assertEquals(ACTOR, a[8]);
    }

    @Test void aBadImageNeverReachesTheDatabase() throws Exception {
        var jdbc = new RecordingJdbc();
        var svc = new BrandingService(jdbc, noR2());
        byte[] notSquare = BrandingImageTest.png(400, 200);
        assertThrows(ResponseStatusException.class, () -> svc.store(TENANT, ACTOR, Kind.MARK, notSquare));
        assertThrows(ResponseStatusException.class, () -> svc.store(TENANT, ACTOR, Kind.LOGO, "<svg/>".getBytes()));
        assertTrue(jdbc.sql.isEmpty());
    }

    @Test void removeClearsOnlyThatImage() {
        var jdbc = new RecordingJdbc();
        var svc = new BrandingService(jdbc, noR2());
        svc.remove(TENANT, ACTOR, Kind.LOGO);
        assertEquals(1, jdbc.sql.size());
        String sql = jdbc.sql.get(0);
        assertTrue(sql.startsWith("UPDATE platform.tenant_branding SET logo_url = NULL"), sql);
        assertTrue(sql.contains("logo_bytes = NULL") && !sql.contains("mark_"), sql);
        assertArrayEquals(new Object[]{ACTOR, TENANT}, jdbc.args.get(0));
    }

    @Test void publicAddressesAreRelativeToTheApiRootAndCarryTheVersion() {
        assertEquals("/v1/public/workspace-branding/" + TENANT + "/logo?v=abc",
                BrandingService.assetPath(TENANT, Kind.LOGO, "abc"));
        assertEquals("/v1/public/workspace-branding/" + TENANT + "/mark",
                BrandingService.assetPath(TENANT, Kind.MARK, null));
    }

    @Test void theSubdomainLookupPrefersTheParameterThenHeaderThenHost() {
        assertEquals("acme", PublicBrandingController.resolve("Acme", "other", "x.example.com"));
        assertEquals("other", PublicBrandingController.resolve(null, "other", "x.example.com"));
        assertEquals("beta", PublicBrandingController.resolve(" ", null, "beta.example.com:443"));
        assertNull(PublicBrandingController.resolve(null, null, "api.example.com"));
        assertNull(PublicBrandingController.resolve(null, null, "www.example.com"));
        assertNull(PublicBrandingController.resolve("bad slug!", null, null));
        assertNull(PublicBrandingController.resolve(null, null, "localhost"));
    }
}
