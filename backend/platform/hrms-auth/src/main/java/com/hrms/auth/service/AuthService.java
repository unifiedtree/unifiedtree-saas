package com.hrms.auth.service;

import com.hrms.auth.dto.AuthResponse;
import com.hrms.auth.dto.LoginRequest;
import com.hrms.auth.dto.MobileOtpRequest;
import com.hrms.auth.dto.MobileOtpResponse;
import com.hrms.auth.dto.RefreshRequest;
import com.hrms.auth.dto.VerifyOtpRequest;
import com.hrms.auth.entity.OtpChallenge;
import com.hrms.auth.entity.RefreshToken;
import com.hrms.auth.entity.UserCredential;
import com.hrms.auth.repository.OtpChallengeRepository;
import com.hrms.auth.repository.RefreshTokenRepository;
import com.hrms.auth.repository.UserCredentialRepository;
import com.hrms.auth.util.JwtTokenProvider;
import com.hrms.core.enums.Role;
import com.hrms.core.exception.BusinessRuleException;
import com.hrms.core.exception.ResourceNotFoundException;
import com.hrms.core.tenant.TenantContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Base64;
import java.util.List;
import java.util.UUID;

@Service("hrmsAuthService")
public class AuthService {

    private static final Logger log = LoggerFactory.getLogger(AuthService.class);
    private static final int MAX_FAILED_ATTEMPTS = 3;
    private static final int LOCKOUT_MINUTES = 30;
    private static final int OTP_EXPIRES_MINUTES = 10;
    private static final int OTP_RESEND_AFTER_SECONDS = 30;

    private final UserCredentialRepository credentialRepository;
    private final OtpChallengeRepository otpChallengeRepository;
    private final RefreshTokenRepository refreshTokenRepository;
    private final JwtTokenProvider jwtTokenProvider;
    private final PasswordEncoder passwordEncoder;
    private final SecureRandom secureRandom = new SecureRandom();

    @Value("${hrms.jwt.access-token-expiry-minutes:15}")
    private long accessTokenExpiryMinutes;

    @Value("${hrms.jwt.refresh-token-expiry-days:7}")
    private long refreshTokenExpiryDays;

    @Value("${hrms.auth.otp.debug-response-enabled:true}")
    private boolean otpDebugResponseEnabled;

    public AuthService(UserCredentialRepository credentialRepository,
                       OtpChallengeRepository otpChallengeRepository,
                       RefreshTokenRepository refreshTokenRepository,
                       JwtTokenProvider jwtTokenProvider,
                       PasswordEncoder passwordEncoder) {
        this.credentialRepository = credentialRepository;
        this.otpChallengeRepository = otpChallengeRepository;
        this.refreshTokenRepository = refreshTokenRepository;
        this.jwtTokenProvider = jwtTokenProvider;
        this.passwordEncoder = passwordEncoder;
    }

    @Transactional
    public AuthResponse login(LoginRequest request, UUID tenantId) {
        TenantContext.setTenantId(tenantId);

        UserCredential credential = credentialRepository
                .findActiveByEmail(request.email())
                .orElseThrow(() -> new BusinessRuleException(
                        "Invalid email or password", "INVALID_CREDENTIALS"));

        if (credential.isLocked()) {
            throw new BusinessRuleException(
                    "Account is temporarily locked. Try again later.", "ACCOUNT_LOCKED");
        }

        if (!passwordEncoder.matches(request.password(), credential.getPasswordHash())) {
            handleFailedAttempt(credential);
            throw new BusinessRuleException("Invalid email or password", "INVALID_CREDENTIALS");
        }

        if (credential.isMfaEnabled()) {
            if (request.mfaCode() == null || request.mfaCode().isBlank()) {
                return new AuthResponse(null, null, 0,
                        credential.getId(), credential.getEmployeeId(), tenantId, credential.getEmail(),
                        credential.getRoles(), true);
            }
            // MFA validation delegated to MfaService (wired separately)
        }

        log.info("Successful login for user {} in tenant {}", credential.getId(), tenantId);

        return issueTokens(credential, tenantId, request.deviceFingerprint());
    }

    @Transactional
    public MobileOtpResponse requestMobileOtp(MobileOtpRequest request, UUID tenantId) {
        TenantContext.setTenantId(tenantId);

        String mobileNumber = normalizeMobile(request.mobileNumber());
        UserCredential credential = credentialRepository
                .findActiveByMobileNumber(mobileNumber)
                .orElseThrow(() -> new BusinessRuleException(
                        "No active account found for this mobile number", "MOBILE_NOT_REGISTERED"));

        if (credential.isLocked()) {
            throw new BusinessRuleException(
                    "Account is temporarily locked. Try again later.", "ACCOUNT_LOCKED");
        }

        String otp = "%06d".formatted(secureRandom.nextInt(1_000_000));
        OtpChallenge challenge = new OtpChallenge();
        challenge.setTenantId(tenantId);
        challenge.setMobileNumber(mobileNumber);
        challenge.setCodeHash(sha256(otp));
        challenge.setExpiresAt(Instant.now().plus(OTP_EXPIRES_MINUTES, ChronoUnit.MINUTES));
        challenge.setDeviceFingerprint(request.deviceFingerprint());
        challenge = otpChallengeRepository.save(challenge);

        log.info("Issued mobile OTP challenge id={} for user={} mobile={}",
                challenge.getId(), credential.getId(), maskMobile(mobileNumber));

        return new MobileOtpResponse(
                challenge.getId(),
                mobileNumber,
                OTP_EXPIRES_MINUTES * 60,
                OTP_RESEND_AFTER_SECONDS,
                "OTP sent successfully",
                otpDebugResponseEnabled ? otp : null);
    }

    @Transactional
    public AuthResponse verifyMobileOtp(VerifyOtpRequest request, UUID tenantId) {
        TenantContext.setTenantId(tenantId);

        String mobileNumber = normalizeMobile(request.mobileNumber());
        OtpChallenge challenge = otpChallengeRepository.findById(request.requestId())
                .orElseThrow(() -> new BusinessRuleException("Invalid OTP request", "OTP_REQUEST_INVALID"));

        if (!mobileNumber.equals(challenge.getMobileNumber())) {
            throw new BusinessRuleException("OTP does not belong to this mobile number", "OTP_MISMATCH");
        }
        if (challenge.isConsumed()) {
            throw new BusinessRuleException("OTP has already been used", "OTP_ALREADY_USED");
        }
        if (challenge.isExpired()) {
            throw new BusinessRuleException("OTP has expired. Please request a new one.", "OTP_EXPIRED");
        }
        if (challenge.getAttempts() >= challenge.getMaxAttempts()) {
            throw new BusinessRuleException("Too many wrong OTP attempts. Please request a new code.", "OTP_LOCKED");
        }

        UserCredential credential = credentialRepository
                .findActiveByMobileNumber(mobileNumber)
                .orElseThrow(() -> new BusinessRuleException(
                        "No active account found for this mobile number", "MOBILE_NOT_REGISTERED"));

        if (!sha256(request.otp()).equals(challenge.getCodeHash())) {
            challenge.setAttempts(challenge.getAttempts() + 1);
            handleFailedAttempt(credential);
            throw new BusinessRuleException("Invalid OTP", "OTP_INVALID");
        }

        challenge.setConsumedAt(Instant.now());
        log.info("Verified mobile OTP challenge id={} user={}", challenge.getId(), credential.getId());
        return issueTokens(credential, tenantId, request.deviceFingerprint());
    }

    @Transactional
    public AuthResponse refresh(RefreshRequest request) {
        String tokenHash = sha256(request.refreshToken());
        RefreshToken stored = refreshTokenRepository.findByTokenHash(tokenHash)
                .orElseThrow(() -> new BusinessRuleException("Invalid refresh token", "INVALID_TOKEN"));

        if (!stored.isValid()) {
            throw new BusinessRuleException("Refresh token is expired or revoked", "TOKEN_EXPIRED");
        }

        TenantContext.setTenantId(stored.getTenantId());

        UserCredential credential = credentialRepository.findById(stored.getUserCredentialId())
                .orElseThrow(() -> new ResourceNotFoundException("User", stored.getUserCredentialId()));

        stored.setRevoked(true);

        String newAccessToken = jwtTokenProvider.generateAccessToken(
                credential.getId(), stored.getTenantId(), credential.getRoles(),
                credential.getEmail(), credential.getEmployeeId());
        String newRawRefreshToken = jwtTokenProvider.generateRefreshToken(
                credential.getId(), stored.getTenantId());

        persistRefreshToken(credential, newRawRefreshToken, stored.getDeviceFingerprint());

        return new AuthResponse(
                newAccessToken, newRawRefreshToken,
                accessTokenExpiryMinutes * 60,
                credential.getId(), credential.getEmployeeId(), stored.getTenantId(), credential.getEmail(),
                credential.getRoles(), false);
    }

    @Transactional
    public void logout(UUID userId) {
        refreshTokenRepository.revokeAllByUserId(userId);
        log.info("Logged out user {}: all refresh tokens revoked", userId);
    }

    private void handleFailedAttempt(UserCredential credential) {
        int attempts = credential.getFailedLoginAttempts() + 1;
        credential.setFailedLoginAttempts(attempts);
        if (attempts >= MAX_FAILED_ATTEMPTS) {
            credential.setLockedUntil(Instant.now().plus(LOCKOUT_MINUTES, ChronoUnit.MINUTES));
            log.warn("Account {} locked after {} failed attempts", credential.getId(), attempts);
        }
    }

    private void persistRefreshToken(UserCredential credential, String rawToken, String deviceFingerprint) {
        RefreshToken refreshToken = new RefreshToken();
        refreshToken.setTenantId(credential.getTenantId());
        refreshToken.setUserCredentialId(credential.getId());
        refreshToken.setTokenHash(sha256(rawToken));
        refreshToken.setExpiresAt(Instant.now().plus(refreshTokenExpiryDays, ChronoUnit.DAYS));
        refreshToken.setDeviceFingerprint(deviceFingerprint);
        refreshTokenRepository.save(refreshToken);
    }

    @Transactional
    public UserCredential createOrUpdateCredentialForEmployee(UUID tenantId,
                                                              UUID employeeId,
                                                              String email,
                                                              String mobileNumber,
                                                              String rawPassword,
                                                              List<Role> roles,
                                                              boolean biometricEnabled) {
        TenantContext.setTenantId(tenantId);

        UserCredential credential = credentialRepository.findByEmail(email)
                .orElseGet(UserCredential::new);
        credential.setTenantId(tenantId);
        credential.setEmployeeId(employeeId);
        credential.setEmail(email);
        credential.setMobileNumber(mobileNumber != null ? normalizeMobile(mobileNumber) : null);
        credential.setPasswordHash(passwordEncoder.encode(
                rawPassword == null || rawPassword.isBlank() ? "Welcome@123" : rawPassword));
        credential.setRoles(roles == null || roles.isEmpty() ? List.of(Role.EMPLOYEE) : roles);
        credential.setActive(true);
        credential.setBiometricEnabled(biometricEnabled);
        credential.setPasswordChangedAt(Instant.now());
        return credentialRepository.save(credential);
    }

    @Transactional(readOnly = true)
    public List<UserCredential> listUsersByTenant(UUID tenantId) {
        TenantContext.setTenantId(tenantId);
        return credentialRepository.findByTenantId(tenantId);
    }

    private AuthResponse issueTokens(UserCredential credential, UUID tenantId, String deviceFingerprint) {
        credential.setFailedLoginAttempts(0);
        credential.setLockedUntil(null);
        credential.setLastLoginAt(Instant.now());

        String accessToken = jwtTokenProvider.generateAccessToken(
                credential.getId(), tenantId, credential.getRoles(),
                credential.getEmail(), credential.getEmployeeId());
        String rawRefreshToken = jwtTokenProvider.generateRefreshToken(credential.getId(), tenantId);

        persistRefreshToken(credential, rawRefreshToken, deviceFingerprint);

        return new AuthResponse(
                accessToken, rawRefreshToken,
                accessTokenExpiryMinutes * 60,
                credential.getId(), credential.getEmployeeId(), tenantId, credential.getEmail(),
                credential.getRoles(), false);
    }

    private String normalizeMobile(String mobileNumber) {
        return mobileNumber == null ? null : mobileNumber.replaceAll("[\\s-]", "");
    }

    private String maskMobile(String mobileNumber) {
        if (mobileNumber == null || mobileNumber.length() <= 4) {
            return "****";
        }
        return "****" + mobileNumber.substring(mobileNumber.length() - 4);
    }

    private String sha256(String input) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest(input.getBytes(StandardCharsets.UTF_8));
            return Base64.getEncoder().encodeToString(hash);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 not available", e);
        }
    }
}
