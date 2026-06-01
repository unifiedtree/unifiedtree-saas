package com.unifiedtree.attendance.face.crypto;

import jakarta.annotation.PostConstruct;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.FloatBuffer;
import java.security.SecureRandom;
import java.util.Base64;

/**
 * AES-GCM-256 envelope around a float32 L2-normalized embedding vector.
 *
 * <p>Ciphertext layout: {@code [12-byte nonce][ciphertext][16-byte GCM tag]}.
 * The GCM tag is appended by the JCE provider automatically.
 *
 * <p>Key source: env {@code UNIFIEDTREE_FACE_ENCRYPTION_KEY}. Must be a
 * 32-byte base64-encoded value. The bean refuses to start if the key is
 * missing or the wrong length so we fail closed at boot.
 */
@Component
public class EmbeddingCipher {

    private static final int GCM_TAG_LENGTH_BITS = 128;
    private static final int GCM_NONCE_LENGTH = 12;

    private final String base64Key;
    private SecretKeySpec key;
    private final SecureRandom rng = new SecureRandom();

    public EmbeddingCipher(@Value("${unifiedtree.face.encryption-key:}") String base64Key) {
        this.base64Key = base64Key;
    }

    @PostConstruct
    void init() {
        if (base64Key == null || base64Key.isBlank()) {
            throw new IllegalStateException(
                    "UNIFIEDTREE_FACE_ENCRYPTION_KEY is not set. Generate with "
                  + "`openssl rand -base64 32` and set on the Spring service.");
        }
        byte[] raw;
        try {
            raw = Base64.getDecoder().decode(base64Key);
        } catch (IllegalArgumentException e) {
            throw new IllegalStateException(
                    "UNIFIEDTREE_FACE_ENCRYPTION_KEY is not valid base64.", e);
        }
        if (raw.length != 32) {
            throw new IllegalStateException(
                    "UNIFIEDTREE_FACE_ENCRYPTION_KEY must decode to 32 bytes (got "
                  + raw.length + ")");
        }
        this.key = new SecretKeySpec(raw, "AES");
    }

    /** Encrypt a float[] embedding to opaque bytes for DB storage. */
    public byte[] encrypt(float[] embedding) {
        try {
            byte[] plain = floatsToBytes(embedding);
            byte[] nonce = new byte[GCM_NONCE_LENGTH];
            rng.nextBytes(nonce);
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.ENCRYPT_MODE, key, new GCMParameterSpec(GCM_TAG_LENGTH_BITS, nonce));
            byte[] ct = c.doFinal(plain);
            ByteBuffer out = ByteBuffer.allocate(nonce.length + ct.length);
            out.put(nonce).put(ct);
            return out.array();
        } catch (Exception e) {
            throw new IllegalStateException("Embedding encryption failed", e);
        }
    }

    /** Decrypt back to a float[]. */
    public float[] decrypt(byte[] envelope) {
        try {
            if (envelope == null || envelope.length <= GCM_NONCE_LENGTH) {
                throw new IllegalArgumentException("envelope too short");
            }
            byte[] nonce = new byte[GCM_NONCE_LENGTH];
            System.arraycopy(envelope, 0, nonce, 0, GCM_NONCE_LENGTH);
            byte[] ct = new byte[envelope.length - GCM_NONCE_LENGTH];
            System.arraycopy(envelope, GCM_NONCE_LENGTH, ct, 0, ct.length);
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(GCM_TAG_LENGTH_BITS, nonce));
            byte[] plain = c.doFinal(ct);
            return bytesToFloats(plain);
        } catch (Exception e) {
            throw new IllegalStateException("Embedding decryption failed", e);
        }
    }

    private static byte[] floatsToBytes(float[] xs) {
        ByteBuffer b = ByteBuffer.allocate(xs.length * Float.BYTES).order(ByteOrder.LITTLE_ENDIAN);
        for (float x : xs) b.putFloat(x);
        return b.array();
    }

    private static float[] bytesToFloats(byte[] raw) {
        if (raw.length % Float.BYTES != 0) {
            throw new IllegalStateException("embedding bytes not float-aligned");
        }
        FloatBuffer fb = ByteBuffer.wrap(raw).order(ByteOrder.LITTLE_ENDIAN).asFloatBuffer();
        float[] out = new float[raw.length / Float.BYTES];
        fb.get(out);
        return out;
    }
}
