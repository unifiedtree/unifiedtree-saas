package com.hrms.api.compliance;

import com.hrms.compliance.repository.InspectorSessionRepository;
import com.hrms.compliance.service.ComplianceService;
import com.hrms.compliance.dto.ComplianceCalendarEventResponse;
import com.hrms.compliance.enums.InspectorSessionStatus;
import com.hrms.core.exception.BusinessRuleException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.time.LocalDate;
import java.util.Base64;
import java.util.List;
import java.util.UUID;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

/** Separate capability format: these tokens are never application JWTs. */
@Service
public class InspectorAccessService {
    private final byte[] key;
    private final InspectorSessionRepository sessions;
    private final ComplianceService compliance;
    private final InspectionDocuments documents;
    public InspectorAccessService(@Value("${unifiedtree.jwt.secret}") String secret, InspectorSessionRepository sessions, ComplianceService compliance, InspectionDocuments documents) {
        this.key = secret.getBytes(StandardCharsets.UTF_8); this.sessions = sessions; this.compliance = compliance; this.documents=documents;
    }
    private String sign(String payload) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256"); mac.init(new SecretKeySpec(key, "HmacSHA256"));
            return Base64.getUrlEncoder().withoutPadding().encodeToString(mac.doFinal(("inspector-read-only:" + payload).getBytes(StandardCharsets.UTF_8)));
        } catch (java.security.GeneralSecurityException e) { throw new IllegalStateException(e); }
    }
    @Transactional(readOnly = true)
    public String issue(UUID id) {
        var session = sessions.findById(id).orElseThrow(() -> denied());
        if (!session.getTenantId().equals(com.hrms.core.tenant.TenantContext.getTenantId()) || session.getStatus() != InspectorSessionStatus.ACTIVE || !session.getExpiresAt().isAfter(Instant.now())) throw denied();
        String payload = session.getTenantId() + "." + id + "." + session.getExpiresAt().getEpochSecond();
        return payload + "." + sign(payload);
    }
    public UUID[] verify(String token) {
        if (token == null || token.length() > 250) throw denied();
        String[] parts = token.split("\\.");
        if (parts.length != 4) throw denied();
        String payload = parts[0] + "." + parts[1] + "." + parts[2];
        if (!MessageDigest.isEqual(sign(payload).getBytes(StandardCharsets.UTF_8), parts[3].getBytes(StandardCharsets.UTF_8))) throw denied();
        try {
            if (Long.parseLong(parts[2]) <= Instant.now().getEpochSecond()) throw denied();
            return new UUID[]{UUID.fromString(parts[0]), UUID.fromString(parts[1])};
        } catch (IllegalArgumentException e) { throw denied(); }
    }
    public record AuditView(String inspectorName, String purpose, Instant expiresAt, List<ComplianceCalendarEventResponse> events, List<InspectionDocuments.Item> documents) {}
    @Transactional
    public AuditView read(UUID id, LocalDate from, LocalDate to) {
        var session = sessions.findById(id).orElseThrow(() -> denied());
        if (!session.getTenantId().equals(com.hrms.core.tenant.TenantContext.getTenantId()) || session.getStatus() != InspectorSessionStatus.ACTIVE || !session.getExpiresAt().isAfter(Instant.now())) throw denied();
        session.setLastAccessedAt(Instant.now());
        return new AuditView(session.getInspectorName(), session.getPurpose(), session.getExpiresAt(), compliance.calendarEvents(session.getCompanyId(), from, to), documents.list(id));
    }
    private static BusinessRuleException denied() { return new BusinessRuleException("This inspection link is invalid, expired or revoked", "INSPECTOR_ACCESS_DENIED"); }
}
