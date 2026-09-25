package com.unifiedtree.auth.mfa;

import java.nio.charset.StandardCharsets;
import java.util.Arrays;

/**
 * A minimal QR Code (ISO/IEC 18004) encoder: byte mode, error-correction level
 * M, automatic version 1-40 and automatic mask choice. It exists so the
 * two-factor setup screen can show a scannable code for the otpauth:// link
 * without pulling a new library into the web app or the build. The algorithm
 * follows Project Nayuki's reference QR Code generator (MIT licence).
 *
 * <p>Modules are indexed {@code [y][x]}; {@code true} is a dark module.
 */
public final class QrCode {

    /** Error-correction level M (index into the tables below; L=0, M=1, Q=2, H=3). */
    private static final int ECL = 1;
    /** The 2-bit format code for level M. */
    private static final int ECL_FORMAT_BITS = 0;

    private static final byte[][] ECC_CODEWORDS_PER_BLOCK = {
        {-1,  7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30},
        {-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28},
        {-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30},
        {-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30},
    };

    private static final byte[][] NUM_ERROR_CORRECTION_BLOCKS = {
        {-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4,  4,  4,  4,  4,  6,  6,  6,  6,  7,  8,  8,  9,  9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25},
        {-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5,  5,  8,  9,  9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49},
        {-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8,  8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68},
        {-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81},
    };

    public final int version;
    public final int size;
    public final int mask;
    private final boolean[][] modules;
    private boolean[][] isFunction;

    /** Encode UTF-8 text (an otpauth:// link) as a QR code. */
    public static QrCode encodeText(String text) {
        return encodeBytes(text.getBytes(StandardCharsets.UTF_8));
    }

    public static QrCode encodeBytes(byte[] data) {
        int version;
        int ccBits;
        for (version = 1; ; version++) {
            ccBits = version <= 9 ? 8 : 16;
            int capacityBits = numDataCodewords(version) * 8;
            if (4 + ccBits + data.length * 8 <= capacityBits) break;
            if (version >= 40) throw new IllegalArgumentException("Data too long for a QR code");
        }
        int capacityBits = numDataCodewords(version) * 8;
        BitBuffer bb = new BitBuffer(capacityBits);
        bb.append(0x4, 4);               // byte mode
        bb.append(data.length, ccBits);
        for (byte b : data) bb.append(b & 0xFF, 8);
        bb.append(0, Math.min(4, capacityBits - bb.length));   // terminator
        bb.append(0, (8 - bb.length % 8) % 8);                 // byte align
        for (int pad = 0xEC; bb.length < capacityBits; pad ^= 0xEC ^ 0x11) bb.append(pad, 8);
        byte[] codewords = new byte[bb.length / 8];
        for (int i = 0; i < bb.length; i++) {
            if (bb.get(i)) codewords[i >>> 3] |= (byte) (1 << (7 - (i & 7)));
        }
        return new QrCode(version, codewords);
    }

    private QrCode(int version, byte[] dataCodewords) {
        this.version = version;
        this.size = version * 4 + 17;
        this.modules = new boolean[size][size];
        this.isFunction = new boolean[size][size];
        drawFunctionPatterns();
        drawCodewords(addEccAndInterleave(dataCodewords));
        int best = 0;
        int minPenalty = Integer.MAX_VALUE;
        for (int m = 0; m < 8; m++) {
            applyMask(m);
            drawFormatBits(m);
            int p = penaltyScore();
            if (p < minPenalty) { best = m; minPenalty = p; }
            applyMask(m);   // XOR again undoes it
        }
        this.mask = best;
        applyMask(best);
        drawFormatBits(best);
        isFunction = null;
    }

    public boolean get(int x, int y) {
        return x >= 0 && x < size && y >= 0 && y < size && modules[y][x];
    }

    /** An SVG image of the code with a quiet zone of {@code border} modules. */
    public String toSvg(int border, String dark, String light) {
        StringBuilder path = new StringBuilder();
        for (int y = 0; y < size; y++) {
            for (int x = 0; x < size; x++) {
                if (modules[y][x]) path.append('M').append(x + border).append(',').append(y + border).append("h1v1h-1z");
            }
        }
        int dim = size + border * 2;
        return "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 " + dim + " " + dim
                + "\" shape-rendering=\"crispEdges\"><rect width=\"100%\" height=\"100%\" fill=\"" + light
                + "\"/><path d=\"" + path + "\" fill=\"" + dark + "\"/></svg>";
    }

    // ---- function patterns ------------------------------------------------

    private void drawFunctionPatterns() {
        for (int i = 0; i < size; i++) {
            setFunction(6, i, i % 2 == 0);
            setFunction(i, 6, i % 2 == 0);
        }
        drawFinder(3, 3);
        drawFinder(size - 4, 3);
        drawFinder(3, size - 4);
        int[] pos = alignmentPositions();
        int n = pos.length;
        for (int i = 0; i < n; i++) {
            for (int j = 0; j < n; j++) {
                if ((i == 0 && j == 0) || (i == 0 && j == n - 1) || (i == n - 1 && j == 0)) continue;
                drawAlignment(pos[i], pos[j]);
            }
        }
        drawFormatBits(0);
        drawVersion();
    }

    private void drawFormatBits(int msk) {
        int data = ECL_FORMAT_BITS << 3 | msk;
        int rem = data;
        for (int i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
        int bits = (data << 10 | rem) ^ 0x5412;
        for (int i = 0; i <= 5; i++) setFunction(8, i, bit(bits, i));
        setFunction(8, 7, bit(bits, 6));
        setFunction(8, 8, bit(bits, 7));
        setFunction(7, 8, bit(bits, 8));
        for (int i = 9; i < 15; i++) setFunction(14 - i, 8, bit(bits, i));
        for (int i = 0; i < 8; i++) setFunction(size - 1 - i, 8, bit(bits, i));
        for (int i = 8; i < 15; i++) setFunction(8, size - 15 + i, bit(bits, i));
        setFunction(8, size - 8, true);
    }

    /** The 15-bit format word as drawn (used by tests to check the BCH code). */
    static int formatWord(int msk) {
        int data = ECL_FORMAT_BITS << 3 | msk;
        int rem = data;
        for (int i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
        return (data << 10 | rem) ^ 0x5412;
    }

    private void drawVersion() {
        if (version < 7) return;
        int rem = version;
        for (int i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
        int bits = version << 12 | rem;
        for (int i = 0; i < 18; i++) {
            boolean b = bit(bits, i);
            int a = size - 11 + i % 3;
            int c = i / 3;
            setFunction(a, c, b);
            setFunction(c, a, b);
        }
    }

    private void drawFinder(int x, int y) {
        for (int dy = -4; dy <= 4; dy++) {
            for (int dx = -4; dx <= 4; dx++) {
                int dist = Math.max(Math.abs(dx), Math.abs(dy));
                int xx = x + dx, yy = y + dy;
                if (xx >= 0 && xx < size && yy >= 0 && yy < size) setFunction(xx, yy, dist != 2 && dist != 4);
            }
        }
    }

    private void drawAlignment(int x, int y) {
        for (int dy = -2; dy <= 2; dy++) {
            for (int dx = -2; dx <= 2; dx++) setFunction(x + dx, y + dy, Math.max(Math.abs(dx), Math.abs(dy)) != 1);
        }
    }

    int[] alignmentPositions() {
        if (version == 1) return new int[0];
        int n = version / 7 + 2;
        int step = (version * 8 + n * 3 + 5) / (n * 4 - 4) * 2;
        int[] result = new int[n];
        result[0] = 6;
        for (int i = n - 1, pos = size - 7; i >= 1; i--, pos -= step) result[i] = pos;
        return result;
    }

    private void setFunction(int x, int y, boolean dark) {
        modules[y][x] = dark;
        isFunction[y][x] = true;
    }

    // ---- data ---------------------------------------------------------------

    private byte[] addEccAndInterleave(byte[] data) {
        int numBlocks = NUM_ERROR_CORRECTION_BLOCKS[ECL][version];
        int eccLen = ECC_CODEWORDS_PER_BLOCK[ECL][version];
        int raw = numRawDataModules(version) / 8;
        int numShort = numBlocks - raw % numBlocks;
        int shortLen = raw / numBlocks;
        byte[][] blocks = new byte[numBlocks][];
        byte[] divisor = rsDivisor(eccLen);
        for (int i = 0, k = 0; i < numBlocks; i++) {
            byte[] dat = Arrays.copyOfRange(data, k, k + shortLen - eccLen + (i < numShort ? 0 : 1));
            k += dat.length;
            byte[] block = Arrays.copyOf(dat, shortLen + 1);
            byte[] ecc = rsRemainder(dat, divisor);
            System.arraycopy(ecc, 0, block, block.length - eccLen, ecc.length);
            blocks[i] = block;
        }
        byte[] result = new byte[raw];
        for (int i = 0, k = 0; i < blocks[0].length; i++) {
            for (int j = 0; j < blocks.length; j++) {
                if (i != shortLen - eccLen || j >= numShort) result[k++] = blocks[j][i];
            }
        }
        return result;
    }

    private void drawCodewords(byte[] data) {
        int i = 0;
        for (int right = size - 1; right >= 1; right -= 2) {
            if (right == 6) right = 5;
            for (int vert = 0; vert < size; vert++) {
                for (int j = 0; j < 2; j++) {
                    int x = right - j;
                    boolean upward = ((right + 1) & 2) == 0;
                    int y = upward ? size - 1 - vert : vert;
                    if (!isFunction[y][x] && i < data.length * 8) {
                        modules[y][x] = bit(data[i >>> 3], 7 - (i & 7));
                        i++;
                    }
                }
            }
        }
    }

    private void applyMask(int msk) {
        for (int y = 0; y < size; y++) {
            for (int x = 0; x < size; x++) {
                boolean invert = switch (msk) {
                    case 0 -> (x + y) % 2 == 0;
                    case 1 -> y % 2 == 0;
                    case 2 -> x % 3 == 0;
                    case 3 -> (x + y) % 3 == 0;
                    case 4 -> (x / 3 + y / 2) % 2 == 0;
                    case 5 -> x * y % 2 + x * y % 3 == 0;
                    case 6 -> (x * y % 2 + x * y % 3) % 2 == 0;
                    default -> ((x + y) % 2 + x * y % 3) % 2 == 0;
                };
                modules[y][x] ^= invert & !isFunction[y][x];
            }
        }
    }

    /** ISO penalty rules N1-N4; the lowest-scoring mask is used. */
    private int penaltyScore() {
        int result = 0;
        // N1 + N3 along rows and columns.
        for (int pass = 0; pass < 2; pass++) {
            for (int a = 0; a < size; a++) {
                int run = 1;
                for (int b = 1; b <= size; b++) {
                    boolean same = b < size && cell(pass, a, b) == cell(pass, a, b - 1);
                    if (same) {
                        run++;
                    } else {
                        if (run >= 5) result += 3 + (run - 5);
                        run = 1;
                    }
                }
                for (int b = 0; b + 11 <= size; b++) {
                    if (finderLike(pass, a, b, true) || finderLike(pass, a, b, false)) result += 40;
                }
            }
        }
        // N2: 2x2 blocks of one colour.
        for (int y = 0; y < size - 1; y++) {
            for (int x = 0; x < size - 1; x++) {
                boolean c = modules[y][x];
                if (c == modules[y][x + 1] && c == modules[y + 1][x] && c == modules[y + 1][x + 1]) result += 3;
            }
        }
        // N4: balance of dark and light.
        int dark = 0;
        for (boolean[] row : modules) for (boolean m : row) if (m) dark++;
        int total = size * size;
        int k = (Math.abs(dark * 20 - total * 10) + total - 1) / total - 1;
        result += Math.max(0, k) * 10;
        return result;
    }

    private boolean cell(int pass, int a, int b) {
        return pass == 0 ? modules[a][b] : modules[b][a];
    }

    private static final boolean[] FINDER_A = {true, false, true, true, true, false, true, false, false, false, false};
    private static final boolean[] FINDER_B = {false, false, false, false, true, false, true, true, true, false, true};

    private boolean finderLike(int pass, int a, int start, boolean first) {
        boolean[] pat = first ? FINDER_A : FINDER_B;
        for (int i = 0; i < pat.length; i++) if (cell(pass, a, start + i) != pat[i]) return false;
        return true;
    }

    // ---- tables and arithmetic ---------------------------------------------

    static int numRawDataModules(int ver) {
        int result = (16 * ver + 128) * ver + 64;
        if (ver >= 2) {
            int n = ver / 7 + 2;
            result -= (25 * n - 10) * n - 55;
            if (ver >= 7) result -= 36;
        }
        return result;
    }

    static int numDataCodewords(int ver) {
        return numRawDataModules(ver) / 8
                - ECC_CODEWORDS_PER_BLOCK[ECL][ver] * NUM_ERROR_CORRECTION_BLOCKS[ECL][ver];
    }

    private static byte[] rsDivisor(int degree) {
        byte[] result = new byte[degree];
        result[degree - 1] = 1;
        int root = 1;
        for (int i = 0; i < degree; i++) {
            for (int j = 0; j < result.length; j++) {
                result[j] = (byte) rsMultiply(result[j] & 0xFF, root);
                if (j + 1 < result.length) result[j] ^= result[j + 1];
            }
            root = rsMultiply(root, 0x02);
        }
        return result;
    }

    private static byte[] rsRemainder(byte[] data, byte[] divisor) {
        byte[] result = new byte[divisor.length];
        for (byte b : data) {
            int factor = (b ^ result[0]) & 0xFF;
            System.arraycopy(result, 1, result, 0, result.length - 1);
            result[result.length - 1] = 0;
            for (int i = 0; i < result.length; i++) result[i] ^= (byte) rsMultiply(divisor[i] & 0xFF, factor);
        }
        return result;
    }

    private static int rsMultiply(int x, int y) {
        int z = 0;
        for (int i = 7; i >= 0; i--) {
            z = (z << 1) ^ ((z >>> 7) * 0x11D);
            z ^= ((y >>> i) & 1) * x;
        }
        return z;
    }

    private static boolean bit(int x, int i) {
        return ((x >>> i) & 1) != 0;
    }

    private static final class BitBuffer {
        private final boolean[] bits;
        int length;
        BitBuffer(int capacity) { bits = new boolean[capacity + 32]; }
        void append(int val, int len) {
            for (int i = len - 1; i >= 0; i--) bits[length++] = ((val >>> i) & 1) != 0;
        }
        boolean get(int i) { return bits[i]; }
    }
}
