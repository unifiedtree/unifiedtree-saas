package com.unifiedtree.attendance.face.crypto;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.FloatBuffer;

/** Little-endian float32 (de)serialization. Shared by service + cipher. */
public final class FloatBufferUtil {
    private FloatBufferUtil() {}

    public static byte[] toLittleEndianBytes(float[] xs) {
        ByteBuffer b = ByteBuffer.allocate(xs.length * Float.BYTES).order(ByteOrder.LITTLE_ENDIAN);
        for (float x : xs) b.putFloat(x);
        return b.array();
    }

    public static float[] fromLittleEndianBytes(byte[] raw) {
        if (raw.length % Float.BYTES != 0) {
            throw new IllegalArgumentException("not float-aligned");
        }
        FloatBuffer fb = ByteBuffer.wrap(raw).order(ByteOrder.LITTLE_ENDIAN).asFloatBuffer();
        float[] out = new float[raw.length / Float.BYTES];
        fb.get(out);
        return out;
    }
}
