package com.unifiedtree.settings.branding;

import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

import java.nio.charset.StandardCharsets;

/**
 * Server-side checks for a workspace logo or mark. The browser's cropper
 * already enforces these, but the client is untrusted: every upload is
 * re-checked here from the bytes alone (the Content-Type and file name the
 * browser sends are ignored).
 *
 * <ul>
 *   <li>Format: PNG, JPEG or WebP, identified by magic bytes. SVG is refused:
 *       it can carry script, and the web cropper exports PNG anyway (an SVG
 *       picked in the browser is rasterised there before upload).</li>
 *   <li>Size: at most 2 MB.</li>
 *   <li>Dimensions, read from the image header: at least 128 px on the
 *       shortest side (so the logo is sharp on the sign-in page and in PDFs),
 *       at most 4096 px on either side (no decompression bombs).</li>
 *   <li>The square mark must actually be square (within 2%).</li>
 * </ul>
 *
 * <p>Pure and static so it is unit-tested without Spring.
 */
public final class BrandingImage {

    public static final long MAX_BYTES = 2L * 1024 * 1024;
    public static final int MIN_SIDE = 128;
    public static final int MAX_SIDE = 4096;

    /** Which slot the image fills. */
    public enum Kind {
        /** Wide logo: sign-in page and document headers. */
        LOGO,
        /** Square mark: app rail, splash, browser tab icon. */
        MARK;

        public static Kind parse(String s) {
            if (s == null) throw bad(HttpStatus.NOT_FOUND, "Unknown branding image");
            return switch (s.trim().toLowerCase(java.util.Locale.ROOT)) {
                case "logo" -> LOGO;
                case "mark" -> MARK;
                default -> throw bad(HttpStatus.NOT_FOUND, "Unknown branding image");
            };
        }

        public String key() { return name().toLowerCase(java.util.Locale.ROOT); }
    }

    /** A checked image: sniffed type, file extension and pixel size. */
    public record Checked(String contentType, String ext, int width, int height) {}

    private BrandingImage() {}

    /**
     * Validate {@code bytes} for {@code kind}. Throws a {@link ResponseStatusException}
     * with a plain-English message (shown as-is in the Settings page) when it fails.
     */
    public static Checked check(byte[] bytes, Kind kind) {
        if (bytes == null || bytes.length == 0) {
            throw bad(HttpStatus.BAD_REQUEST, "No file uploaded");
        }
        if (bytes.length > MAX_BYTES) {
            throw bad(HttpStatus.PAYLOAD_TOO_LARGE, "The image must be 2 MB or smaller");
        }
        if (looksLikeSvg(bytes)) {
            throw bad(HttpStatus.UNSUPPORTED_MEDIA_TYPE,
                    "SVG files can't be uploaded directly. Pick the file in Branding: the editor converts it to PNG");
        }
        String type = sniff(bytes);
        if (type == null) {
            throw bad(HttpStatus.UNSUPPORTED_MEDIA_TYPE, "Only PNG, JPEG and WebP images are allowed");
        }
        int[] wh = switch (type) {
            case "image/png" -> pngSize(bytes);
            case "image/jpeg" -> jpegSize(bytes);
            default -> webpSize(bytes);
        };
        if (wh == null || wh[0] <= 0 || wh[1] <= 0) {
            throw bad(HttpStatus.UNSUPPORTED_MEDIA_TYPE, "The image is damaged or incomplete. Export it again and retry");
        }
        int w = wh[0], h = wh[1];
        if (w > MAX_SIDE || h > MAX_SIDE) {
            throw bad(HttpStatus.UNPROCESSABLE_ENTITY,
                    "The image is " + w + " × " + h + " px. Use one no larger than " + MAX_SIDE + " px on each side");
        }
        if (Math.min(w, h) < MIN_SIDE) {
            throw bad(HttpStatus.UNPROCESSABLE_ENTITY,
                    "The image is " + w + " × " + h + " px. It must be at least " + MIN_SIDE
                            + " px on its shortest side so it stays sharp");
        }
        if (kind == Kind.MARK && Math.abs(w - h) > Math.max(2, Math.round(Math.max(w, h) * 0.02f))) {
            throw bad(HttpStatus.UNPROCESSABLE_ENTITY,
                    "The square mark must be square (it is " + w + " × " + h + " px). Crop it to a square first");
        }
        String ext = switch (type) {
            case "image/png" -> "png";
            case "image/jpeg" -> "jpg";
            default -> "webp";
        };
        return new Checked(type, ext, w, h);
    }

    /** Magic-byte sniff. Returns null for anything that is not PNG, JPEG or WebP. */
    static String sniff(byte[] b) {
        if (b == null || b.length < 12) return null;
        if ((b[0] & 0xFF) == 0x89 && b[1] == 'P' && b[2] == 'N' && b[3] == 'G'
                && b[4] == 0x0D && b[5] == 0x0A && b[6] == 0x1A && b[7] == 0x0A) return "image/png";
        if ((b[0] & 0xFF) == 0xFF && (b[1] & 0xFF) == 0xD8 && (b[2] & 0xFF) == 0xFF) return "image/jpeg";
        if (b[0] == 'R' && b[1] == 'I' && b[2] == 'F' && b[3] == 'F'
                && b[8] == 'W' && b[9] == 'E' && b[10] == 'B' && b[11] == 'P') return "image/webp";
        return null;
    }

    static boolean looksLikeSvg(byte[] b) {
        int n = Math.min(b.length, 512);
        String head = new String(b, 0, n, StandardCharsets.ISO_8859_1).trim().toLowerCase(java.util.Locale.ROOT);
        if (head.startsWith("﻿")) head = head.substring(1);
        return head.startsWith("<?xml") || head.startsWith("<svg") || head.contains("<svg");
    }

    /** PNG: IHDR is always the first chunk; width and height are big-endian at 16 and 20. */
    static int[] pngSize(byte[] b) {
        if (b.length < 24) return null;
        if (b[12] != 'I' || b[13] != 'H' || b[14] != 'D' || b[15] != 'R') return null;
        return new int[]{be32(b, 16), be32(b, 20)};
    }

    /** JPEG: walk the markers to the first start-of-frame (SOF0..SOF15, not DHT/JPG/DAC). */
    static int[] jpegSize(byte[] b) {
        int i = 2;
        while (i + 9 < b.length) {
            if ((b[i] & 0xFF) != 0xFF) return null;
            int marker = b[i + 1] & 0xFF;
            if (marker == 0xFF) { i++; continue; }          // fill byte
            if (marker == 0xD8 || marker == 0x01 || (marker >= 0xD0 && marker <= 0xD7)) { i += 2; continue; }
            if (marker == 0xD9 || marker == 0xDA) return null; // end / scan before any frame header
            int len = ((b[i + 2] & 0xFF) << 8) | (b[i + 3] & 0xFF);
            if (len < 2) return null;
            boolean sof = marker >= 0xC0 && marker <= 0xCF && marker != 0xC4 && marker != 0xC8 && marker != 0xCC;
            if (sof) {
                int h = ((b[i + 5] & 0xFF) << 8) | (b[i + 6] & 0xFF);
                int w = ((b[i + 7] & 0xFF) << 8) | (b[i + 8] & 0xFF);
                return new int[]{w, h};
            }
            i += 2 + len;
        }
        return null;
    }

    /** WebP: VP8 (lossy), VP8L (lossless) or VP8X (extended) header right after "WEBP". */
    static int[] webpSize(byte[] b) {
        if (b.length < 30) return null;
        String chunk = new String(b, 12, 4, StandardCharsets.US_ASCII);
        switch (chunk) {
            case "VP8 " -> {
                // Frame tag (3) + start code 9D 01 2A at 23..25, then 14-bit width / height.
                if ((b[23] & 0xFF) != 0x9D || (b[24] & 0xFF) != 0x01 || (b[25] & 0xFF) != 0x2A) return null;
                int w = ((b[26] & 0xFF) | ((b[27] & 0xFF) << 8)) & 0x3FFF;
                int h = ((b[28] & 0xFF) | ((b[29] & 0xFF) << 8)) & 0x3FFF;
                return new int[]{w, h};
            }
            case "VP8L" -> {
                if ((b[20] & 0xFF) != 0x2F) return null;
                int b0 = b[21] & 0xFF, b1 = b[22] & 0xFF, b2 = b[23] & 0xFF, b3 = b[24] & 0xFF;
                int w = 1 + (b0 | ((b1 & 0x3F) << 8));
                int h = 1 + ((b1 >> 6) | (b2 << 2) | ((b3 & 0x0F) << 10));
                return new int[]{w, h};
            }
            case "VP8X" -> {
                int w = 1 + ((b[24] & 0xFF) | ((b[25] & 0xFF) << 8) | ((b[26] & 0xFF) << 16));
                int h = 1 + ((b[27] & 0xFF) | ((b[28] & 0xFF) << 8) | ((b[29] & 0xFF) << 16));
                return new int[]{w, h};
            }
            default -> { return null; }
        }
    }

    private static int be32(byte[] b, int o) {
        long v = ((long) (b[o] & 0xFF) << 24) | ((b[o + 1] & 0xFF) << 16) | ((b[o + 2] & 0xFF) << 8) | (b[o + 3] & 0xFF);
        return v > Integer.MAX_VALUE ? -1 : (int) v;
    }

    private static ResponseStatusException bad(HttpStatus status, String message) {
        return new ResponseStatusException(status, message);
    }

    /** First letter of a workspace name, upper-cased; "W" when there is nothing usable. */
    public static String monogram(String name) {
        if (name != null) {
            String t = name.strip();
            for (int i = 0; i < t.length(); ) {
                int cp = t.codePointAt(i);
                if (Character.isLetterOrDigit(cp)) {
                    return new String(Character.toChars(cp)).toUpperCase(java.util.Locale.ROOT);
                }
                i += Character.charCount(cp);
            }
        }
        return "W";
    }
}
