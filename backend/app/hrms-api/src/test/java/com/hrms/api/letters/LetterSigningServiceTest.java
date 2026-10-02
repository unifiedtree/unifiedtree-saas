package com.hrms.api.letters;

import com.hrms.api.hiring.FakeJdbc;
import com.hrms.core.exception.FeatureNotReady;
import com.hrms.core.exception.HrmsException;
import com.hrms.letters.dto.GenerateLetterRequest;
import com.hrms.letters.dto.GeneratedLetterDto;
import com.hrms.letters.dto.SendLetterRequest;
import com.hrms.letters.service.LetterGenerationService;
import com.unifiedtree.audit.AuditService;
import com.unifiedtree.security.tenant.TenantContext;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.http.HttpStatus;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

/**
 * BW-76: who may sign, when, and what is kept; asking for a signature on
 * generate and send; the employee told once; and the answers while V143.60
 * is missing (nothing generated or sent when a signature is asked).
 */
class LetterSigningServiceTest {

    private final UUID tenant = UUID.randomUUID();
    private final UUID owner = UUID.randomUUID();
    private final UUID letterId = UUID.randomUUID();
    private final LetterGenerationService letters = mock(LetterGenerationService.class);
    private final ApplicationEventPublisher events = mock(ApplicationEventPublisher.class);
    private final AuditService audit = mock(AuditService.class);

    @BeforeEach void tenant() { TenantContext.setTenantId(tenant); TenantContext.setUserId(UUID.randomUUID()); }
    @AfterEach void clear() { TenantContext.clear(); }

    private GeneratedLetterDto letter(String status, Instant sentAt) {
        return new GeneratedLetterDto(letterId, tenant, UUID.randomUUID(), UUID.randomUUID(), owner, "OFFER", "Offer letter",
                status, true, 100L, sentAt, "a@b.c", null, null, null, UUID.randomUUID(), Map.of(), Instant.now(), Instant.now(),
                "Asha Rao", "E1", null, null, null, null, null, null, null, null);
    }

    private static Map<String, Object> row(Object... kv) {
        Map<String, Object> m = new HashMap<>();
        for (int i = 0; i < kv.length; i += 2) m.put((String) kv[i], kv[i + 1]);
        return m;
    }

    private LetterSigningService service(FakeJdbc db) {
        return new LetterSigningService(db.jdbc, letters, events, audit);
    }

    private FakeJdbc ready() {
        return new FakeJdbc().tables(Map.of(LetterSigningService.TABLE, true));
    }

    // ── signing ──────────────────────────────────────────────────────────────

    @Test void theOwnerSignsASentLetterThatAsksForIt() {
        FakeJdbc db = ready().on("SELECT signed_at FROM letters.letter_signatures", List.of(row("signed_at", null)));
        when(letters.getGenerated(letterId)).thenReturn(letter("VIEWED", Instant.now()));
        when(letters.isSentToEmployee(letterId)).thenReturn(true);
        GeneratedLetterDto signed = letter("SIGNED", Instant.now());
        when(letters.markSigned(eq(letterId), any())).thenReturn(signed);

        assertSame(signed, service(db).sign(letterId, owner, "  Asha   Rao ", "10.0.0.1", "Firefox"));

        FakeJdbc.Call update = db.callsContaining("SET signed_at").get(0);
        assertEquals("Asha Rao", update.args().get(1));
        assertEquals("10.0.0.1", update.args().get(2));
        assertEquals("Firefox", update.args().get(3));
        assertEquals(tenant, update.args().get(4));
        assertTrue(db.callsContaining("FOR UPDATE").get(0).sql().contains("tenant_id = ?"));
        verify(letters).markSigned(eq(letterId), any());
    }

    @Test void someoneElseCannotSignIt() {
        FakeJdbc db = ready();
        when(letters.getGenerated(letterId)).thenReturn(letter("SENT", Instant.now()));
        when(letters.isSentToEmployee(letterId)).thenReturn(true);
        HrmsException e = assertThrows(HrmsException.class, () -> service(db).sign(letterId, UUID.randomUUID(), "Asha Rao", null, null));
        assertEquals(HttpStatus.NOT_FOUND, e.getStatus());
        verify(letters, never()).markSigned(any(), any());
    }

    @Test void anUnsentDraftCannotBeSigned() {
        FakeJdbc db = ready();
        when(letters.getGenerated(letterId)).thenReturn(letter("GENERATED", null));
        when(letters.isSentToEmployee(letterId)).thenReturn(false);
        assertEquals(HttpStatus.NOT_FOUND,
                assertThrows(HrmsException.class, () -> service(db).sign(letterId, owner, "Asha Rao", null, null)).getStatus());
    }

    @Test void aLetterWithNoSignatureAskedCannotBeSigned() {
        FakeJdbc db = ready().on("SELECT signed_at FROM letters.letter_signatures", List.of());
        when(letters.getGenerated(letterId)).thenReturn(letter("SENT", Instant.now()));
        when(letters.isSentToEmployee(letterId)).thenReturn(true);
        HrmsException e = assertThrows(HrmsException.class, () -> service(db).sign(letterId, owner, "Asha Rao", null, null));
        assertEquals("SIGNATURE_NOT_REQUESTED", e.getErrorCode());
    }

    @Test void signingTwiceIsRefused() {
        FakeJdbc db = ready().on("SELECT signed_at FROM letters.letter_signatures", List.of(row("signed_at", Timestamp.from(Instant.now()))));
        when(letters.getGenerated(letterId)).thenReturn(letter("SIGNED", Instant.now()));
        when(letters.isSentToEmployee(letterId)).thenReturn(true);
        assertEquals("LETTER_ALREADY_SIGNED",
                assertThrows(HrmsException.class, () -> service(db).sign(letterId, owner, "Asha Rao", null, null)).getErrorCode());
    }

    @Test void aVoidedLetterCannotBeSigned() {
        FakeJdbc db = ready().on("SELECT signed_at FROM letters.letter_signatures", List.of(row("signed_at", null)));
        when(letters.getGenerated(letterId)).thenReturn(letter("VOID", Instant.now()));
        when(letters.isSentToEmployee(letterId)).thenReturn(true);
        assertEquals("LETTER_NOT_SIGNABLE",
                assertThrows(HrmsException.class, () -> service(db).sign(letterId, owner, "Asha Rao", null, null)).getErrorCode());
    }

    @Test void aTypedNameIsNeeded() {
        FakeJdbc db = ready();
        assertEquals("SIGNATURE_NAME_REQUIRED",
                assertThrows(HrmsException.class, () -> service(db).sign(letterId, owner, " a ", null, null)).getErrorCode());
        assertEquals("SIGNATURE_NAME_TOO_LONG",
                assertThrows(HrmsException.class, () -> service(db).sign(letterId, owner, "x".repeat(201), null, null)).getErrorCode());
    }

    @Test void withoutTheTableSigningIsNotSwitchedOn() {
        FakeJdbc db = new FakeJdbc().tables(Map.of());
        assertThrows(FeatureNotReady.class, () -> service(db).sign(letterId, owner, "Asha Rao", null, null));
        assertTrue(service(db).of(List.of(letterId)).isEmpty());
    }

    // ── asking and telling ───────────────────────────────────────────────────

    @Test void askingRecordsWhoAskedAndRefusesVoidOrSignedLetters() {
        UUID hr = UUID.randomUUID();
        FakeJdbc db = ready().on("auth.user_credentials", List.of("Priya Rao"));
        service(db).request(letter("GENERATED", null), hr);
        FakeJdbc.Call insert = db.callsContaining("INSERT INTO letters.letter_signatures").get(0);
        assertEquals(List.of(tenant, letterId, owner, hr, "Priya Rao"), insert.args());
        assertTrue(insert.sql().contains("ON CONFLICT"));

        assertEquals("LETTER_VOIDED", assertThrows(HrmsException.class, () -> service(db).request(letter("VOID", null), hr)).getErrorCode());
        assertEquals("LETTER_ALREADY_SIGNED", assertThrows(HrmsException.class, () -> service(db).request(letter("SIGNED", null), hr)).getErrorCode());
    }

    @Test void theEmployeeIsToldOnceTheLetterIsSentAndOnlyOnce() {
        FakeJdbc db = ready().on("SET notified_at", List.of("Priya Rao"));
        service(db).notifyIfAsked(letter("SENT", Instant.now()));
        verify(events).publishEvent(new LetterSignatureRequestedEvent(tenant, letterId, owner, "Offer letter", "Priya Rao"));

        FakeJdbc already = ready().on("SET notified_at", List.of());
        reset(events);
        service(already).notifyIfAsked(letter("SENT", Instant.now()));
        verifyNoInteractions(events);
    }

    @Test void nothingIsToldWhileTheLetterIsADraft() {
        FakeJdbc db = ready();
        service(db).notifyIfAsked(letter("GENERATED", null));
        assertTrue(db.callsContaining("notified_at").isEmpty());
        verifyNoInteractions(events);
    }

    // ── generate and send ────────────────────────────────────────────────────

    @Test void askingWithoutTheTableGeneratesNothing() {
        LetterSigningService signing = service(new FakeJdbc().tables(Map.of()));
        LetterIssueService issue = new LetterIssueService(letters, signing);
        GenerateLetterRequest req = new GenerateLetterRequest(UUID.randomUUID(), owner, null, false, null, null, true);
        assertThrows(FeatureNotReady.class, () -> issue.generate(req, UUID.randomUUID()));
        verify(letters, never()).generate(any(), any());

        assertThrows(FeatureNotReady.class, () -> issue.send(letterId, new SendLetterRequest(null, null, true), UUID.randomUUID()));
        verify(letters, never()).sendLetter(any(), any());
    }

    @Test void withoutASignatureAskedGenerateAndSendWorkAsBefore() {
        LetterSigningService signing = service(new FakeJdbc().tables(Map.of()));
        LetterIssueService issue = new LetterIssueService(letters, signing);
        GenerateLetterRequest req = new GenerateLetterRequest(UUID.randomUUID(), owner, null, false, null);
        when(letters.generate(req, null)).thenReturn(letter("GENERATED", null));
        assertEquals("GENERATED", issue.generate(req, null).status());
        when(letters.sendLetter(eq(letterId), any())).thenReturn(letter("SENT", Instant.now()));
        assertEquals("SENT", issue.send(letterId, new SendLetterRequest(null, null), null).status());
    }

    @Test void askingOnSendAsksBeforeTheEmailGoes() {
        FakeJdbc db = ready().on("SET notified_at", List.of(""));
        LetterIssueService issue = new LetterIssueService(letters, service(db));
        when(letters.getGenerated(letterId)).thenReturn(letter("GENERATED", null));
        when(letters.sendLetter(eq(letterId), any())).thenReturn(letter("SENT", Instant.now()));
        issue.send(letterId, new SendLetterRequest(null, null, true), UUID.randomUUID());
        var order = inOrder(letters);
        order.verify(letters).getGenerated(letterId);
        order.verify(letters).sendLetter(eq(letterId), any());
        assertEquals(1, db.callsContaining("INSERT INTO letters.letter_signatures").size());
        verify(events).publishEvent(new LetterSignatureRequestedEvent(tenant, letterId, owner, "Offer letter", null));
    }
}
