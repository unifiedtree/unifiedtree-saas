package com.hrms.core.crypto;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.Base64;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class FieldEncryptorTest {

    // 32 zero bytes, base64-encoded
    private static final String KEY_B64 = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

    private FieldEncryptor encryptor;

    @BeforeEach
    void setUp() {
        encryptor = new FieldEncryptor(KEY_B64);
    }

    @Test
    void nullInputReturnsNull() {
        assertThat(encryptor.encrypt(null)).isNull();
        assertThat(encryptor.decrypt(null)).isNull();
    }

    @Test
    void encryptProducesNonPlaintextOutput() {
        String ct = encryptor.encrypt("ABCDE1234F");
        assertThat(ct).isNotNull().isNotEqualTo("ABCDE1234F");
    }

    @Test
    void decryptRoundTripsPlaintext() {
        String plaintext = "ABCDE1234F";
        assertThat(encryptor.decrypt(encryptor.encrypt(plaintext))).isEqualTo(plaintext);
    }

    @Test
    void encryptionIsNonDeterministic() {
        String a = encryptor.encrypt("ABCDE1234F");
        String b = encryptor.encrypt("ABCDE1234F");
        assertThat(a).isNotEqualTo(b);
    }

    @Test
    void ciphertextHasAesGcmStructure() {
        // Layout: iv[12] || ciphertext[n] || gcm-tag[16]; "ABCDE1234F" is 10 bytes → ≥ 38
        byte[] bytes = Base64.getDecoder().decode(encryptor.encrypt("ABCDE1234F"));
        assertThat(bytes.length).isGreaterThanOrEqualTo(38);
    }

    @Test
    void wrongKeyFailsDecryption() {
        String ct = encryptor.encrypt("secret");
        FieldEncryptor otherKey = new FieldEncryptor(
                Base64.getEncoder().encodeToString(new byte[32])); // all-zeros but separate instance
        // Same all-zeros key → should still decrypt (same bytes, same key)
        // Use a different key to trigger AES-GCM tag failure
        byte[] key2 = new byte[32];
        key2[0] = 1;
        FieldEncryptor differentKey = new FieldEncryptor(Base64.getEncoder().encodeToString(key2));
        assertThatThrownBy(() -> differentKey.decrypt(ct))
                .isInstanceOf(FieldEncryptor.PiiEncryptionException.class);
    }

    @Test
    void shortKeyThrowsIllegalArgument() {
        String shortKey = Base64.getEncoder().encodeToString(new byte[16]); // 16 bytes, not 32
        assertThatThrownBy(() -> new FieldEncryptor(shortKey))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("32 bytes");
    }

    @Test
    void emptyStringRoundTrips() {
        assertThat(encryptor.decrypt(encryptor.encrypt(""))).isEqualTo("");
    }
}
