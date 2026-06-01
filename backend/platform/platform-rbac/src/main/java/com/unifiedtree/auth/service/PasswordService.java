package com.unifiedtree.auth.service;

import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;

/**
 * Tiny wrapper around Spring Security's BCryptPasswordEncoder. Single
 * source of truth for the cost factor and matching semantics across the
 * canonical auth code.
 */
@Service
public class PasswordService {

    private final PasswordEncoder encoder = new BCryptPasswordEncoder(10);

    public String hash(String raw) {
        return encoder.encode(raw);
    }

    public boolean matches(String raw, String hash) {
        if (raw == null || hash == null) return false;
        return encoder.matches(raw, hash);
    }
}
