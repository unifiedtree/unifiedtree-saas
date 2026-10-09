package com.hrms.api.access;

import com.hrms.core.exception.BusinessRuleException;
import com.hrms.api.mail.MailService;
import com.unifiedtree.auth.entity.UserCredentials;
import com.unifiedtree.auth.repository.UserCredentialsRepository;
import com.unifiedtree.auth.service.PasswordService;
import com.unifiedtree.auth.session.SessionService;
import com.unifiedtree.notifications.service.AppNotificationService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.transaction.PlatformTransactionManager;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/** Ownership transfer (owner decisions, 6 Oct 2026). */
class OwnershipTransferServiceTest {

    private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
    private final WorkspaceAccessService access = mock(WorkspaceAccessService.class);
    private final AccessGuard guard = mock(AccessGuard.class);
    private final UserCredentialsRepository creds = mock(UserCredentialsRepository.class);
    private final PasswordService passwords = mock(PasswordService.class);
    private final SessionService sessions = mock(SessionService.class);
    private final OwnershipTransferService service = new OwnershipTransferService(jdbc, access, guard, creds, passwords,
            sessions, mock(AppNotificationService.class), mock(AccessAudit.class), mock(MailService.class),
            mock(PlatformTransactionManager.class));

    private final UUID tenant = UUID.randomUUID();
    private final UUID owner = UUID.randomUUID();
    private final UUID asha = UUID.randomUUID();
    private final UUID id = UUID.randomUUID();

    private static UserCredentials login(UUID id, String email, boolean active) {
        UserCredentials c = new UserCredentials();
        c.setEmail(email);
        c.setActive(active);
        c.setPasswordHash("hash");
        return c;
    }

    @BeforeEach
    void setUp() {
        when(jdbc.queryForObject(contains("to_regclass"), eq(Boolean.class))).thenReturn(true);
        when(guard.isOwner(owner)).thenReturn(true);
        when(creds.findById(owner)).thenReturn(Optional.of(login(owner, "owner@acme.test", true)));
        when(creds.findById(asha)).thenReturn(Optional.of(login(asha, "asha@acme.test", true)));
    }

    @SuppressWarnings("unchecked")
    private void openTransfer(String status, Instant expiresAt) {
        OwnershipTransferService.Transfer t = new OwnershipTransferService.Transfer(id, status, owner, "owner@acme.test",
                asha, "asha@acme.test", null, Instant.now(), expiresAt, null, null, false, false, false);
        when(jdbc.query(contains("WHERE id = ? AND tenant_id = ?"), any(RowMapper.class), eq(id), eq(tenant))).thenReturn(List.of(t));
    }

    @Test
    void onlyTheOwnerCanStartAndOnlyWithTheirPassword() {
        when(guard.isOwner(asha)).thenReturn(false);
        assertThatThrownBy(() -> service.start(tenant, asha, owner, "pw", null))
                .isInstanceOfSatisfying(BusinessRuleException.class, e -> org.assertj.core.api.Assertions.assertThat(e.getErrorCode()).isEqualTo("OWNER_ONLY"));

        when(passwords.matches("wrong", "hash")).thenReturn(false);
        assertThatThrownBy(() -> service.start(tenant, owner, asha, "wrong", null))
                .isInstanceOfSatisfying(BusinessRuleException.class, e -> org.assertj.core.api.Assertions.assertThat(e.getErrorCode()).isEqualTo("PASSWORD_WRONG"));
        verify(jdbc, never()).update(contains("INSERT INTO platform.ownership_transfers"), any(Object[].class));
    }

    @Test
    void theNewOwnerMustHaveAnActiveLoginAndNotBeTheOwner() {
        when(passwords.matches("pw", "hash")).thenReturn(true);
        assertThatThrownBy(() -> service.start(tenant, owner, owner, "pw", null))
                .isInstanceOfSatisfying(BusinessRuleException.class, e -> org.assertj.core.api.Assertions.assertThat(e.getErrorCode()).isEqualTo("SAME_PERSON"));
        UUID invited = UUID.randomUUID();
        when(creds.findById(invited)).thenReturn(Optional.of(login(invited, "new@acme.test", false)));
        assertThatThrownBy(() -> service.start(tenant, owner, invited, "pw", null))
                .isInstanceOfSatisfying(BusinessRuleException.class, e -> org.assertj.core.api.Assertions.assertThat(e.getErrorCode()).isEqualTo("USER_NOT_ACTIVE"));
    }

    @Test
    void onlyOneOpenTransferAtATime() {
        when(passwords.matches("pw", "hash")).thenReturn(true);
        when(jdbc.update(contains("INSERT INTO platform.ownership_transfers"), any(Object[].class)))
                .thenThrow(new DuplicateKeyException("ux_ownership_transfers_open"));
        assertThatThrownBy(() -> service.start(tenant, owner, asha, "pw", null))
                .isInstanceOfSatisfying(BusinessRuleException.class, e -> org.assertj.core.api.Assertions.assertThat(e.getErrorCode()).isEqualTo("TRANSFER_OPEN"));
    }

    @Test
    void onlyThePersonOfferedCanAccept() {
        openTransfer("PENDING", Instant.now().plusSeconds(3600));
        assertThatThrownBy(() -> service.accept(tenant, owner, id))
                .isInstanceOfSatisfying(BusinessRuleException.class, e -> org.assertj.core.api.Assertions.assertThat(e.getErrorCode()).isEqualTo("NOT_ALLOWED"));
        verify(access, never()).transferOwnership(any(), any(), any());
    }

    @Test
    void acceptingMovesTheRolesAndSignsBothOut() {
        openTransfer("PENDING", Instant.now().plusSeconds(3600));
        when(creds.findById(asha)).thenReturn(Optional.of(login(asha, "asha@acme.test", true)));
        when(jdbc.update(contains("SET status = 'TRANSITION'"), any(Object[].class))).thenReturn(1);
        when(jdbc.queryForList(contains("FROM platform.accounts"), eq(UUID.class), any(Object[].class))).thenReturn(List.of(UUID.randomUUID()));
        service.accept(tenant, asha, id);

        verify(access).transferOwnership(tenant, owner, asha);
        verify(jdbc).update(contains("SET status = 'TRANSITION'"), any(Object[].class));
        verify(sessions).revokeAll(tenant, owner);
        verify(sessions).revokeAll(tenant, asha);
    }

    @Test
    void anExpiredOfferCantBeAccepted() {
        openTransfer("PENDING", Instant.now().minusSeconds(60));
        assertThatThrownBy(() -> service.accept(tenant, asha, id))
                .isInstanceOfSatisfying(BusinessRuleException.class, e -> org.assertj.core.api.Assertions.assertThat(e.getErrorCode()).isEqualTo("TRANSFER_EXPIRED"));
        verify(access, never()).transferOwnership(any(), any(), any());
    }

    @Test
    void onlyTheNewOwnerEndsTheHandoverEarly() {
        openTransfer("TRANSITION", Instant.now());
        assertThatThrownBy(() -> service.endTransition(tenant, owner, id))
                .isInstanceOfSatisfying(BusinessRuleException.class, e -> org.assertj.core.api.Assertions.assertThat(e.getErrorCode()).isEqualTo("NOT_ALLOWED"));
        when(jdbc.update(contains("SET status = 'COMPLETED'"), any(Object[].class))).thenReturn(1);
        service.endTransition(tenant, asha, id);
        verify(access).endOwnerTransition(tenant, owner, asha);   // the new owner is recorded as who ended it
        verify(sessions).revokeAll(eq(tenant), eq(owner));
    }

    @Test
    void acceptLosesToACancelThatGotThereFirst() {
        // Read as PENDING, but by the time accept claims it a cancel has committed: nothing moves.
        openTransfer("PENDING", Instant.now().plusSeconds(3600));
        when(jdbc.update(contains("SET status = 'TRANSITION'"), any(Object[].class))).thenReturn(0);
        assertThatThrownBy(() -> service.accept(tenant, asha, id))
                .isInstanceOfSatisfying(BusinessRuleException.class, e -> org.assertj.core.api.Assertions.assertThat(e.getErrorCode()).isEqualTo("TRANSFER_NOT_OPEN"));
        verify(access, never()).transferOwnership(any(), any(), any());
        verify(sessions, never()).revokeAll(any(), any());
    }

    @Test
    void cancelLosesToAnAcceptThatGotThereFirst() {
        openTransfer("PENDING", Instant.now().plusSeconds(3600));
        when(jdbc.update(contains("WHERE id = ? AND status = ?"), any(Object[].class))).thenReturn(0);
        assertThatThrownBy(() -> service.cancel(tenant, owner, id))
                .isInstanceOfSatisfying(BusinessRuleException.class, e -> org.assertj.core.api.Assertions.assertThat(e.getErrorCode()).isEqualTo("TRANSFER_NOT_OPEN"));
    }

    @Test
    void aHandoverAlreadyEndedIsNotEndedTwice() {
        openTransfer("TRANSITION", Instant.now());
        when(jdbc.update(contains("SET status = 'COMPLETED'"), any(Object[].class))).thenReturn(0);
        assertThatThrownBy(() -> service.endTransition(tenant, asha, id)).isInstanceOf(BusinessRuleException.class);
        verify(access, never()).endOwnerTransition(any(), any(), any());
    }

    @Test
    void fiveWrongPasswordsThenAPause() {
        when(passwords.matches("wrong", "hash")).thenReturn(false);
        for (int i = 0; i < 5; i++) {
            assertThatThrownBy(() -> service.start(tenant, owner, asha, "wrong", null))
                    .isInstanceOfSatisfying(BusinessRuleException.class, e -> org.assertj.core.api.Assertions.assertThat(e.getErrorCode()).isEqualTo("PASSWORD_WRONG"));
        }
        when(passwords.matches("pw", "hash")).thenReturn(true);
        assertThatThrownBy(() -> service.start(tenant, owner, asha, "pw", null))
                .isInstanceOfSatisfying(BusinessRuleException.class, e -> org.assertj.core.api.Assertions.assertThat(e.getErrorCode()).isEqualTo("RATE_LIMITED"));
    }

    @Test
    void theNoteHasALimit() {
        when(passwords.matches("pw", "hash")).thenReturn(true);
        assertThatThrownBy(() -> service.start(tenant, owner, asha, "pw", "x".repeat(501)))
                .isInstanceOfSatisfying(BusinessRuleException.class, e -> org.assertj.core.api.Assertions.assertThat(e.getErrorCode()).isEqualTo("NOTE_TOO_LONG"));
    }

    @Test
    void aNewOwnerWhoSignsInWithGoogleOnlyStillGetsAnAccount() {
        // platform.accounts needs a password or a Google id; a Google-only login has no password.
        UserCredentials google = login(asha, "asha@acme.test", true);
        google.setPasswordHash(null);
        when(jdbc.queryForList(contains("FROM platform.accounts"), eq(UUID.class), any(Object[].class))).thenReturn(List.of());
        when(passwords.hash(any())).thenReturn("random-hash");
        service.accountFor(google, "Asha");
        verify(jdbc).update(contains("INSERT INTO platform.accounts"), any(), eq("asha@acme.test"), eq("Asha"), eq("random-hash"));
    }
}
