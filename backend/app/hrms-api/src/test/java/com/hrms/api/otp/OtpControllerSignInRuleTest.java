package com.hrms.api.otp;

import com.hrms.core.exception.HrmsException;
import com.hrms.notification.msg91.Msg91Client;
import com.unifiedtree.auth.entity.OtpRequest;
import com.unifiedtree.auth.otp.OtpService;
import com.unifiedtree.auth.phone.PhoneLookupService;
import com.unifiedtree.auth.phone.PhoneSignInRule;
import com.unifiedtree.auth.ratelimit.PublicEndpointRateLimiter;
import com.unifiedtree.auth.service.AuthService;
import jakarta.servlet.http.HttpServletRequest;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;

import java.time.OffsetDateTime;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** Owner's decision Q-21: the MSG91 path sends no SMS, and signs nobody in, for what the rule refuses. */
class OtpControllerSignInRuleTest {

    private final OtpService otp = mock(OtpService.class);
    private final Msg91Client msg91 = mock(Msg91Client.class);
    private final PhoneSignInRule rule = mock(PhoneSignInRule.class);
    private final AuthService auth = mock(AuthService.class);
    private final OtpController controller =
            new OtpController(otp, msg91, rule, auth, mock(PublicEndpointRateLimiter.class), 60);
    private final HttpServletRequest http = mock(HttpServletRequest.class);

    private static HrmsException several() {
        return new HrmsException("This number is on more than one login. Sign in with your email.",
                HttpStatus.CONFLICT, "PHONE_ON_SEVERAL_LOGINS");
    }

    private static HrmsException twoFactor() {
        return new HrmsException("Your login uses two-factor sign-in. Use your password.",
                HttpStatus.FORBIDDEN, "USE_PASSWORD_FOR_TWO_FACTOR");
    }

    private static OtpRequest row(String phone) {
        OtpRequest r = new OtpRequest();
        r.setId(UUID.randomUUID());
        r.setCorrelationId(UUID.randomUUID());
        r.setPhoneE164(phone);
        r.setPhoneLast10(phone.substring(phone.length() - 10));
        r.setPurpose(OtpRequest.PURPOSE_LOGIN);
        r.setSentAt(OffsetDateTime.now().minusMinutes(5));
        r.setExpiresAt(OffsetDateTime.now().plusMinutes(5));
        return r;
    }

    @Test
    void aNumberOnSeveralLoginsGetsNoSms() {
        when(rule.forTheApp("+919876543210")).thenThrow(several());
        assertThatThrownBy(() -> controller.request(new OtpController.OtpRequestBody("98765 43210", null), http))
                .isInstanceOfSatisfying(HrmsException.class, e -> assertThat(e.getErrorCode()).isEqualTo("PHONE_ON_SEVERAL_LOGINS"));
        verify(otp, never()).createNewOtp(any(), any(), any(), any(), any());
        verify(msg91, never()).sendOtp(any(), any(), any());
    }

    @Test
    void aTwoFactorLoginGetsNoSms() {
        when(rule.forTheApp("+919876543210")).thenThrow(twoFactor());
        assertThatThrownBy(() -> controller.request(new OtpController.OtpRequestBody("+91 98765 43210", null), http))
                .isInstanceOfSatisfying(HrmsException.class, e -> assertThat(e.getErrorCode()).isEqualTo("USE_PASSWORD_FOR_TWO_FACTOR"));
        verify(msg91, never()).sendOtp(any(), any(), any());
    }

    @Test
    void anUnknownNumberStillGetsTheUsualAnswer() {
        // Enum-leak protection as before: 200 with a request id (no login on file is only said at /verify).
        when(rule.forTheApp("+919876543210")).thenReturn(Optional.empty());
        OtpRequest r = row("+919876543210");
        when(otp.createNewOtp(anyString(), anyString(), anyString(), any(), any())).thenReturn(new OtpService.NewOtp(r, "123456"));
        when(msg91.sendOtp(any(), any(), any())).thenReturn(Msg91Client.Msg91SendResult.failure("PROVIDER_NOT_CONFIGURED", 0));
        assertThat(controller.request(new OtpController.OtpRequestBody("9876543210", null), http).getStatusCode().value()).isEqualTo(200);
        verify(msg91).sendOtp(any(), any(), any());
    }

    @Test
    void aResendIsCheckedToo() {
        OtpRequest r = row("+919876543210");
        when(otp.findById(r.getId())).thenReturn(Optional.of(r));
        when(rule.forTheApp("+919876543210")).thenThrow(several());
        assertThatThrownBy(() -> controller.resend(new OtpController.OtpResendBody(r.getId().toString()), http))
                .isInstanceOf(HrmsException.class);
        verify(otp, never()).createNewOtp(any(), any(), any(), any(), any());
        verify(msg91, never()).sendOtp(any(), any(), any());
    }

    @Test
    void aRightCodeSignsNobodyInWhenTheNumberIsNowOnSeveralLogins() {
        UUID id = UUID.randomUUID();
        when(otp.attemptVerify(id, "123456")).thenReturn(OtpService.VerifyOutcome.ok("+919876543210"));
        when(rule.forTheApp("+919876543210")).thenThrow(several());
        assertThatThrownBy(() -> controller.verify(new OtpController.OtpVerifyBody(id.toString(), "123456"), http))
                .isInstanceOfSatisfying(HrmsException.class, e -> assertThat(e.getStatus()).isEqualTo(HttpStatus.CONFLICT));
        verify(auth, never()).issueWorkspaceSession(any(), any());
    }

    @Test
    void aRightCodeSignsInTheOneLogin() {
        UUID id = UUID.randomUUID();
        PhoneLookupService.Match m = new PhoneLookupService.Match(UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(), "o@acme.test");
        when(otp.attemptVerify(id, "123456")).thenReturn(OtpService.VerifyOutcome.ok("+919876543210"));
        when(rule.forTheApp("+919876543210")).thenReturn(Optional.of(m));
        controller.verify(new OtpController.OtpVerifyBody(id.toString(), "123456"), http);
        verify(auth).issueWorkspaceSession(m.tenantId(), m.authUserId());
        com.unifiedtree.security.tenant.TenantContext.clear();
        com.hrms.core.tenant.TenantContext.clear();
    }
}
