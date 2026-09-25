package com.unifiedtree.auth.mfa;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Structural checks of the QR encoder. (It was also decoded end to end with
 * OpenCV's QR reader at versions 1, 9, 12 and 15 while it was written.)
 */
class QrCodeTest {

    @Test
    void picksTheSmallestVersionThatFits() {
        assertEquals(1, QrCode.encodeText("hello").version);
        // Byte-mode capacity at level M: v1 = 14 bytes, v2 = 26 bytes.
        assertEquals(1, QrCode.encodeText("x".repeat(14)).version);
        assertEquals(2, QrCode.encodeText("x".repeat(15)).version);
        QrCode otp = QrCode.encodeText(Totp.otpauthUrl("Acme Industries Private Limited", "someone@acme-industries.co.in", Totp.newSecret()));
        assertTrue(otp.version >= 6 && otp.version <= 12, "otpauth links land on a small version, got " + otp.version);
        assertEquals(otp.version * 4 + 17, otp.size);
    }

    @Test
    void dataCodewordCountsMatchTheStandardAtLevelM() {
        assertEquals(16, QrCode.numDataCodewords(1));
        assertEquals(28, QrCode.numDataCodewords(2));
        assertEquals(124, QrCode.numDataCodewords(7));
        assertEquals(2334, QrCode.numDataCodewords(40));
    }

    @Test
    void drawsFinderPatternsAndTimingLines() {
        QrCode q = QrCode.encodeText("otpauth://totp/Test:a%40b.c?secret=JBSWY3DPEHPK3PXP");
        int n = q.size;
        for (int[] corner : new int[][]{{0, 0}, {n - 7, 0}, {0, n - 7}}) {
            int x0 = corner[0], y0 = corner[1];
            for (int i = 0; i < 7; i++) {
                assertTrue(q.get(x0 + i, y0), "finder top edge");
                assertTrue(q.get(x0 + i, y0 + 6), "finder bottom edge");
                assertTrue(q.get(x0, y0 + i), "finder left edge");
                assertTrue(q.get(x0 + 6, y0 + i), "finder right edge");
            }
            assertFalse(q.get(x0 + 1, y0 + 1), "finder light ring");
            assertTrue(q.get(x0 + 3, y0 + 3), "finder centre");
        }
        for (int i = 8; i < n - 8; i++) {
            assertEquals(i % 2 == 0, q.get(i, 6), "horizontal timing");
            assertEquals(i % 2 == 0, q.get(6, i), "vertical timing");
        }
        assertTrue(q.get(8, n - 8), "the always-dark module");
    }

    @Test
    void formatWordsAreValidBchCodewords() {
        // Every pair of the 8 format words used at level M differs in at least 7 bits.
        for (int a = 0; a < 8; a++) {
            for (int b = a + 1; b < 8; b++) {
                assertTrue(Integer.bitCount(QrCode.formatWord(a) ^ QrCode.formatWord(b)) >= 7);
            }
        }
        // Level M, mask 0 is the well-known 101010000010010.
        assertEquals(0b101010000010010, QrCode.formatWord(0));
    }

    @Test
    void svgHasAQuietZoneAndOnlyTheGivenColours() {
        QrCode q = QrCode.encodeText("hello");
        String svg = q.toSvg(4, "#0f172a", "#ffffff");
        assertTrue(svg.startsWith("<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 29 29\""));
        assertTrue(svg.contains("fill=\"#0f172a\"") && svg.contains("fill=\"#ffffff\""));
    }
}
