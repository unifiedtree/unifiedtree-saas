package com.unifiedtree.settings.branding;

import com.unifiedtree.settings.branding.BrandingImage.Kind;
import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;

import static org.junit.jupiter.api.Assertions.*;

/** Server-side re-validation of workspace logo / mark uploads (white label, V143.15). */
class BrandingImageTest {

    static byte[] png(int w, int h) throws Exception {
        var out = new ByteArrayOutputStream();
        ImageIO.write(new BufferedImage(w, h, BufferedImage.TYPE_INT_ARGB), "png", out);
        return out.toByteArray();
    }

    static byte[] jpeg(int w, int h) throws Exception {
        var out = new ByteArrayOutputStream();
        ImageIO.write(new BufferedImage(w, h, BufferedImage.TYPE_INT_RGB), "jpg", out);
        return out.toByteArray();
    }

    /** A minimal RIFF/WEBP header with a VP8X chunk declaring w × h. */
    static byte[] webpVp8x(int w, int h) {
        byte[] b = new byte[40];
        put(b, 0, "RIFF"); put(b, 8, "WEBP"); put(b, 12, "VP8X");
        int ww = w - 1, hh = h - 1;
        b[24] = (byte) ww; b[25] = (byte) (ww >> 8); b[26] = (byte) (ww >> 16);
        b[27] = (byte) hh; b[28] = (byte) (hh >> 8); b[29] = (byte) (hh >> 16);
        return b;
    }

    /** VP8L (lossless): signature 0x2F then 14-bit width-1 / height-1. */
    static byte[] webpVp8l(int w, int h) {
        byte[] b = new byte[40];
        put(b, 0, "RIFF"); put(b, 8, "WEBP"); put(b, 12, "VP8L");
        b[20] = 0x2F;
        int ww = w - 1, hh = h - 1;
        b[21] = (byte) ww;
        b[22] = (byte) (((ww >> 8) & 0x3F) | ((hh & 0x03) << 6));
        b[23] = (byte) (hh >> 2);
        b[24] = (byte) ((hh >> 10) & 0x0F);
        return b;
    }

    /** VP8 (lossy): start code 9D 01 2A at 23, then 14-bit width / height. */
    static byte[] webpVp8(int w, int h) {
        byte[] b = new byte[40];
        put(b, 0, "RIFF"); put(b, 8, "WEBP"); put(b, 12, "VP8 ");
        b[23] = (byte) 0x9D; b[24] = 0x01; b[25] = 0x2A;
        b[26] = (byte) w; b[27] = (byte) ((w >> 8) & 0x3F);
        b[28] = (byte) h; b[29] = (byte) ((h >> 8) & 0x3F);
        return b;
    }

    static void put(byte[] b, int at, String s) {
        byte[] a = s.getBytes(StandardCharsets.US_ASCII);
        System.arraycopy(a, 0, b, at, a.length);
    }

    static int status(Runnable r) {
        var e = assertThrows(ResponseStatusException.class, r::run);
        return e.getStatusCode().value();
    }

    @Test void acceptsASquarePngMarkAndReportsItsSize() throws Exception {
        var c = BrandingImage.check(png(256, 256), Kind.MARK);
        assertEquals("image/png", c.contentType());
        assertEquals("png", c.ext());
        assertEquals(256, c.width());
        assertEquals(256, c.height());
    }

    @Test void readsJpegDimensionsFromTheFrameHeader() throws Exception {
        var c = BrandingImage.check(jpeg(512, 128), Kind.LOGO);
        assertEquals("image/jpeg", c.contentType());
        assertEquals(512, c.width());
        assertEquals(128, c.height());
    }

    @Test void readsAllThreeWebpHeaderVariants() {
        var x = BrandingImage.check(webpVp8x(600, 200), Kind.LOGO);
        assertEquals("image/webp", x.contentType());
        assertEquals(600, x.width());
        assertEquals(200, x.height());
        var l = BrandingImage.check(webpVp8l(300, 300), Kind.MARK);
        assertEquals(300, l.width());
        assertEquals(300, l.height());
        var v = BrandingImage.check(webpVp8(1024, 256), Kind.LOGO);
        assertEquals(1024, v.width());
        assertEquals(256, v.height());
    }

    @Test void refusesImagesUnder128PxOnTheShortestSide() throws Exception {
        byte[] thin = png(600, 100), tiny = png(64, 64);
        assertEquals(422, status(() -> check(thin, Kind.LOGO)));
        assertEquals(422, status(() -> check(tiny, Kind.MARK)));
        // Exactly 128 is fine.
        assertEquals(128, BrandingImage.check(png(512, 128), Kind.LOGO).height());
    }

    @Test void theMarkMustBeSquareButTheLogoNeedNot() throws Exception {
        byte[] oblong = png(300, 200);
        assertEquals(422, status(() -> check(oblong, Kind.MARK)));
        assertEquals(300, BrandingImage.check(png(300, 200), Kind.LOGO).width());
        // Within 2% counts as square (a one-pixel rounding slip from a cropper).
        assertEquals(257, BrandingImage.check(png(257, 256), Kind.MARK).width());
    }

    @Test void refusesHugeDimensions() {
        assertEquals(422, status(() -> BrandingImage.check(webpVp8x(5000, 400), Kind.LOGO)));
    }

    @Test void refusesFilesOver2Mb() {
        byte[] big = new byte[(int) BrandingImage.MAX_BYTES + 1];
        big[0] = (byte) 0x89; big[1] = 'P'; big[2] = 'N'; big[3] = 'G';
        assertEquals(413, status(() -> BrandingImage.check(big, Kind.LOGO)));
    }

    @Test void refusesSvgGifAndAnythingElseWhateverItClaimsToBe() {
        byte[] svg = "<?xml version=\"1.0\"?><svg xmlns=\"http://www.w3.org/2000/svg\"><script>alert(1)</script></svg>"
                .getBytes(StandardCharsets.UTF_8);
        assertEquals(415, status(() -> BrandingImage.check(svg, Kind.MARK)));
        assertEquals(415, status(() -> BrandingImage.check("<svg onload=alert(1)>".repeat(3).getBytes(StandardCharsets.UTF_8), Kind.MARK)));
        byte[] gif = "GIF89a\u0001\u0000\u0001\u0000\u0000\u0000".getBytes(StandardCharsets.ISO_8859_1);
        assertEquals(415, status(() -> BrandingImage.check(gif, Kind.MARK)));
        assertEquals(415, status(() -> BrandingImage.check("hello world, not an image".getBytes(StandardCharsets.UTF_8), Kind.LOGO)));
        assertEquals(400, status(() -> BrandingImage.check(new byte[0], Kind.LOGO)));
    }

    @Test void refusesATruncatedPng() throws Exception {
        byte[] full = png(256, 256);
        byte[] cut = java.util.Arrays.copyOf(full, 14); // signature + part of IHDR
        assertEquals(415, status(() -> BrandingImage.check(cut, Kind.MARK)));
    }

    @Test void kindParsingIsStrict() {
        assertEquals(Kind.LOGO, Kind.parse("logo"));
        assertEquals(Kind.MARK, Kind.parse(" MARK "));
        assertEquals(404, status(() -> Kind.parse("favicon")));
        assertEquals(404, status(() -> Kind.parse(null)));
    }

    @Test void monogramIsTheFirstLetterOrDigitOfTheWorkspaceName() {
        assertEquals("A", BrandingImage.monogram("acme corp"));
        assertEquals("9", BrandingImage.monogram("  9to5 Works"));
        assertEquals("É", BrandingImage.monogram("- élan HR"));
        assertEquals("W", BrandingImage.monogram("  "));
        assertEquals("W", BrandingImage.monogram(null));
    }

    private static void check(byte[] b, Kind k) {
        BrandingImage.check(b, k);
    }
}
