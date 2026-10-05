package com.hrms.api.ess.around;

import com.hrms.api.ess.EssCaller;
import com.hrms.api.ess.around.CelebrationWishService.Mine;
import com.hrms.api.ess.around.CelebrationWishService.Occasion;
import com.hrms.api.ess.around.CelebrationWishService.Person;
import com.hrms.api.ess.around.CelebrationWishService.SendRequest;
import com.hrms.api.ess.around.CelebrationWishService.SendResult;
import com.hrms.api.ess.around.CelebrationWishService.Wish;
import com.hrms.api.settings.CelebrationSettingService;
import com.hrms.core.exception.FeatureNotReady;
import com.hrms.core.exception.HrmsException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;

import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * Send wishes: only to people of the sender's own company and workspace, never
 * themself, only on the day (a welcome: in the first 30 days), no birthday wishes
 * where birthdays are hidden, one per sender, person, occasion and date (again:
 * the wish already sent, nobody told twice), a plain message of 1 to 280
 * characters; nothing without the table.
 */
class CelebrationWishServiceTest {

    private static final UUID TENANT = UUID.randomUUID();
    private static final UUID OTHER_TENANT = UUID.randomUUID();
    private static final UUID COMPANY = UUID.randomUUID();
    private static final LocalDate TODAY = LocalDate.of(2026, 10, 5);
    private static final UUID ME = UUID.randomUUID();
    private static final UUID KAVYA = UUID.randomUUID();
    private static final Instant SAVED_AT = Instant.parse("2026-10-05T04:30:00Z");

    private JdbcTemplate jdbc;
    private CelebrationSettingService settings;
    private ApplicationEventPublisher events;
    private CelebrationWishService service;

    private static Person person(UUID id, UUID company, String name, LocalDate born, LocalDate joined, boolean active) {
        return new Person(id, company, name, born, joined, active);
    }

    private static EssCaller caller(UUID tenant, UUID employee) {
        return new EssCaller(tenant, employee, Set.of(), null, TODAY);
    }

    @BeforeEach
    void wire() {
        jdbc = mock(JdbcTemplate.class);
        settings = mock(CelebrationSettingService.class);
        events = mock(ApplicationEventPublisher.class);
        when(settings.showBirthdays(any(), any())).thenReturn(true);
        when(jdbc.queryForObject(eq("SELECT to_regclass(?) IS NOT NULL"), eq(Boolean.class), eq("hrms.celebration_wishes"))).thenReturn(true);
        service = new CelebrationWishService(jdbc, settings, events);
    }

    /** The person lookup answers for this workspace only: anyone else's id finds nobody. */
    private void people(Person... found) {
        when(jdbc.query(contains("FROM hrms.employees e"), any(RowMapper.class), any(), any())).thenReturn(List.of());
        for (Person p : found) {
            when(jdbc.query(contains("FROM hrms.employees e"), any(RowMapper.class), eq(TENANT), eq(p.id()))).thenReturn(List.of(p));
        }
    }

    private void insertSaves(boolean saved) {
        when(jdbc.query(contains("INSERT INTO hrms.celebration_wishes"), any(RowMapper.class),
                any(), any(), any(), any(), any(), any(), any(), any())).thenReturn(saved ? List.of(SAVED_AT) : List.of());
    }

    private Person me() {
        return person(ME, COMPANY, "Priya Rao", LocalDate.of(1992, 4, 1), LocalDate.of(2023, 1, 9), true);
    }

    private static String code(Runnable r) {
        return assertThrows(HrmsException.class, r::run).getErrorCode();
    }

    @Test void aBirthdayWishIsSavedForTodayAndThePersonIsTold() {
        people(me(), person(KAVYA, COMPANY, "Kavya Menon", LocalDate.of(1990, 10, 5), LocalDate.of(2024, 3, 1), true));
        insertSaves(true);

        SendResult r = service.send(caller(TENANT, ME), new SendRequest(KAVYA, "BIRTHDAY", "  Happy birthday,\n Kavya! 🎂  "));

        assertTrue(r.created());
        assertEquals("Happy birthday, Kavya! 🎂", r.wish().message());
        assertEquals("BIRTHDAY", r.wish().occasion());
        assertEquals(TODAY, r.wish().occasionDate());
        assertEquals("Priya Rao", r.wish().fromName());
        ArgumentCaptor<Object> args = ArgumentCaptor.forClass(Object.class);
        verify(jdbc).query(contains("ON CONFLICT (tenant_id, from_employee_id, to_employee_id, occasion, occasion_date) DO NOTHING"),
                any(RowMapper.class), args.capture(), args.capture(), args.capture(), args.capture(), args.capture(),
                args.capture(), args.capture(), args.capture());
        List<Object> v = args.getAllValues();
        assertEquals(List.of(TENANT, COMPANY, ME, KAVYA, "BIRTHDAY", TODAY, "Happy birthday, Kavya! 🎂"), v.subList(1, 8));
        ArgumentCaptor<CelebrationWishSentEvent> sent = ArgumentCaptor.forClass(CelebrationWishSentEvent.class);
        verify(events).publishEvent(sent.capture());
        assertEquals(TENANT, sent.getValue().tenantId());
        assertEquals(KAVYA, sent.getValue().toEmployeeId());
        assertEquals(ME, sent.getValue().fromEmployeeId());
        assertEquals("Priya Rao", sent.getValue().senderName());
        assertEquals(Occasion.BIRTHDAY, sent.getValue().occasion());
    }

    @Test void sendingTheSameWishAgainAnswersTheOneAlreadySentAndTellsNobody() {
        people(me(), person(KAVYA, COMPANY, "Kavya Menon", LocalDate.of(1990, 10, 5), LocalDate.of(2024, 3, 1), true));
        insertSaves(false);
        Wish before = new Wish(UUID.randomUUID(), ME, "Priya Rao", KAVYA, "BIRTHDAY", TODAY, "Happy birthday!", SAVED_AT);
        when(jdbc.query(contains("w.occasion = ? AND w.occasion_date = ?"), any(RowMapper.class),
                eq(TENANT), eq(ME), eq(KAVYA), eq("BIRTHDAY"), eq(TODAY))).thenReturn(List.of(before));

        SendResult r = service.send(caller(TENANT, ME), new SendRequest(KAVYA, "birthday", "Happy birthday again!"));

        assertFalse(r.created());
        assertSame(before, r.wish());
        verify(events, never()).publishEvent(any());
    }

    @Test void nobodyCanWishThemself() {
        people(me());
        assertEquals("CELEBRATION_WISH_SELF", code(() -> service.send(caller(TENANT, ME), new SendRequest(ME, "BIRTHDAY", "Hi"))));
        verify(events, never()).publishEvent(any());
    }

    @Test void onlyPeopleOfTheSendersOwnCompanyAndWorkspace() {
        UUID elsewhere = UUID.randomUUID(), gone = UUID.randomUUID(), foreign = UUID.randomUUID();
        people(me(),
                person(elsewhere, UUID.randomUUID(), "Other Company", LocalDate.of(1990, 10, 5), LocalDate.of(2020, 1, 1), true),
                person(gone, COMPANY, "Has Left", LocalDate.of(1990, 10, 5), LocalDate.of(2020, 1, 1), false));
        // Someone of another workspace is looked up with the caller's own workspace, so nobody is found.
        when(jdbc.query(contains("FROM hrms.employees e"), any(RowMapper.class), eq(OTHER_TENANT), eq(foreign)))
                .thenReturn(List.of(person(foreign, COMPANY, "Foreign", LocalDate.of(1990, 10, 5), LocalDate.of(2020, 1, 1), true)));
        for (UUID to : List.of(elsewhere, gone, foreign)) {
            assertEquals("CELEBRATION_WISH_PERSON_INVALID",
                    code(() -> service.send(caller(TENANT, ME), new SendRequest(to, "BIRTHDAY", "Hi"))), String.valueOf(to));
        }
        verify(jdbc, never()).query(contains("INSERT INTO"), any(RowMapper.class), any(), any(), any(), any(), any(), any(), any(), any());
        verify(events, never()).publishEvent(any());
    }

    @Test void birthdayWishesAreOffWhereBirthdaysAreHiddenButTheOthersAreNot() {
        when(settings.showBirthdays(TENANT, COMPANY)).thenReturn(false);
        people(me(), person(KAVYA, COMPANY, "Kavya Menon", LocalDate.of(1990, 10, 5), LocalDate.of(2021, 10, 5), true));
        insertSaves(true);
        assertEquals("CELEBRATION_BIRTHDAYS_HIDDEN",
                code(() -> service.send(caller(TENANT, ME), new SendRequest(KAVYA, "BIRTHDAY", "Happy birthday!"))));
        SendResult r = service.send(caller(TENANT, ME), new SendRequest(KAVYA, "WORK_ANNIVERSARY", "Congratulations on 5 years!"));
        assertTrue(r.created());
        assertEquals("ANNIVERSARY", r.wish().occasion());
    }

    @Test void onlyOnTheDayAndAWelcomeInTheFirstThirtyDays() {
        Person bornToday = person(KAVYA, COMPANY, "K", LocalDate.of(1990, 10, 5), null, true);
        assertEquals(TODAY, CelebrationWishService.occasionDate(Occasion.BIRTHDAY, bornToday, TODAY));
        Person bornTomorrow = person(KAVYA, COMPANY, "K", LocalDate.of(1990, 10, 6), null, true);
        assertEquals("CELEBRATION_WISH_NOT_THE_DAY", code(() -> CelebrationWishService.occasionDate(Occasion.BIRTHDAY, bornTomorrow, TODAY)));
        Person noBirthday = person(KAVYA, COMPANY, "K", null, null, true);
        assertEquals("CELEBRATION_WISH_NOT_THE_DAY", code(() -> CelebrationWishService.occasionDate(Occasion.BIRTHDAY, noBirthday, TODAY)));
        // 29 February falls on 28 February in other years, as on the list.
        Person leap = person(KAVYA, COMPANY, "K", LocalDate.of(2000, 2, 29), null, true);
        assertEquals(LocalDate.of(2027, 2, 28), CelebrationWishService.occasionDate(Occasion.BIRTHDAY, leap, LocalDate.of(2027, 2, 28)));

        Person fiveYears = person(KAVYA, COMPANY, "K", null, LocalDate.of(2021, 10, 5), true);
        assertEquals(TODAY, CelebrationWishService.occasionDate(Occasion.ANNIVERSARY, fiveYears, TODAY));
        Person joinedToday = person(KAVYA, COMPANY, "K", null, TODAY, true);
        assertEquals("CELEBRATION_WISH_NOT_THE_DAY", code(() -> CelebrationWishService.occasionDate(Occasion.ANNIVERSARY, joinedToday, TODAY)),
                "the joining day itself is no anniversary");

        assertEquals(TODAY, CelebrationWishService.occasionDate(Occasion.WELCOME, joinedToday, TODAY));
        Person thirtyDays = person(KAVYA, COMPANY, "K", null, TODAY.minusDays(30), true);
        assertEquals(TODAY.minusDays(30), CelebrationWishService.occasionDate(Occasion.WELCOME, thirtyDays, TODAY));
        Person thirtyOne = person(KAVYA, COMPANY, "K", null, TODAY.minusDays(31), true);
        assertEquals("CELEBRATION_WISH_NOT_THE_DAY", code(() -> CelebrationWishService.occasionDate(Occasion.WELCOME, thirtyOne, TODAY)));
        Person notYet = person(KAVYA, COMPANY, "K", null, TODAY.plusDays(1), true);
        assertEquals("CELEBRATION_WISH_NOT_THE_DAY", code(() -> CelebrationWishService.occasionDate(Occasion.WELCOME, notYet, TODAY)));
    }

    @Test void theMessageIsPlainTextOfOneTo280Characters() {
        assertEquals("Hi there", CelebrationWishService.clean("  Hi\r\n\n\tthere ‮​ "));
        assertEquals("Welcome aboard! 👋🏽 👨‍👩‍👧", CelebrationWishService.clean("Welcome aboard! 👋🏽 👨‍👩‍👧"), "emoji stay whole");
        assertEquals("<b>hi</b>", CelebrationWishService.validMessage("<b>hi</b>"), "kept as text; never rendered as HTML");
        HrmsException empty = assertThrows(HrmsException.class, () -> CelebrationWishService.validMessage(" \n "));
        assertEquals("CELEBRATION_WISH_EMPTY", empty.getErrorCode());
        assertEquals(HttpStatus.BAD_REQUEST, empty.getStatus());
        assertEquals("CELEBRATION_WISH_EMPTY", code(() -> CelebrationWishService.validMessage(null)));
        assertEquals(280, CelebrationWishService.validMessage("a".repeat(280)).length());
        assertEquals("CELEBRATION_WISH_TOO_LONG", code(() -> CelebrationWishService.validMessage("a".repeat(281))));
    }

    @Test void theOccasionIsOneOfTheThreeOrTheListsOwnKind() {
        assertEquals(Occasion.BIRTHDAY, Occasion.parse(" birthday "));
        assertEquals(Occasion.ANNIVERSARY, Occasion.parse("ANNIVERSARY"));
        assertEquals(Occasion.ANNIVERSARY, Occasion.parse("WORK_ANNIVERSARY"));
        assertEquals(Occasion.WELCOME, Occasion.parse("NEW_JOINER"));
        assertNull(Occasion.parse("RETIREMENT"));
        assertNull(Occasion.parse(null));
        people(me());
        assertEquals("CELEBRATION_WISH_OCCASION_INVALID", code(() -> service.send(caller(TENANT, ME), new SendRequest(KAVYA, "PROMOTION", "Hi"))));
        assertEquals("CELEBRATION_WISH_PERSON_REQUIRED", code(() -> service.send(caller(TENANT, ME), new SendRequest(null, "BIRTHDAY", "Hi"))));
    }

    @Test void aLoginWithoutAnEmployeeRecordSendsNothingAndReceivesNothing() {
        assertEquals("NO_EMPLOYEE_RECORD", code(() -> service.send(caller(TENANT, null), new SendRequest(KAVYA, "BIRTHDAY", "Hi"))));
        Mine mine = service.mine(caller(TENANT, null));
        assertTrue(mine.received().isEmpty());
        assertEquals(0, mine.receivedPeople());
        assertTrue(mine.sent().isEmpty());
        verify(jdbc, never()).query(contains("FROM hrms.celebration_wishes"), any(RowMapper.class), any(), any(), any(), any());
    }

    @Test void withoutTheTableBothAnswerFeatureNotReady() {
        when(jdbc.queryForObject(eq("SELECT to_regclass(?) IS NOT NULL"), eq(Boolean.class), eq("hrms.celebration_wishes"))).thenReturn(false);
        people(me(), person(KAVYA, COMPANY, "Kavya Menon", LocalDate.of(1990, 10, 5), null, true));
        assertThrows(FeatureNotReady.class, () -> service.send(caller(TENANT, ME), new SendRequest(KAVYA, "BIRTHDAY", "Hi")));
        assertThrows(FeatureNotReady.class, () -> service.mine(caller(TENANT, ME)));
        verify(events, never()).publishEvent(any());
    }

    @Test void mineReadsTheCallersOwnWishesInTheirWorkspace() {
        Wish w = new Wish(UUID.randomUUID(), KAVYA, "Kavya Menon", ME, "BIRTHDAY", TODAY, "Happy birthday!", SAVED_AT);
        Timestamp since = Timestamp.from(TODAY.minusDays(7).atStartOfDay(ZoneId.of("Asia/Kolkata")).toInstant());
        when(jdbc.query(contains("w.to_employee_id = ? AND w.created_at >= ?"), any(RowMapper.class), eq(TENANT), eq(ME), eq(since), eq(100)))
                .thenReturn(List.of(w));
        when(jdbc.queryForObject(contains("count(DISTINCT from_employee_id)"), eq(Integer.class), eq(TENANT), eq(ME), eq(since))).thenReturn(1);
        CelebrationWishService.SentRef ref = new CelebrationWishService.SentRef(KAVYA, "WELCOME", TODAY.minusDays(3));
        when(jdbc.query(contains("from_employee_id = ? AND occasion_date >= ?"), any(RowMapper.class), eq(TENANT), eq(ME), eq(TODAY.minusDays(30)), eq(500)))
                .thenReturn(List.of(ref));

        Mine mine = service.mine(caller(TENANT, ME));

        assertEquals(TODAY, mine.today());
        assertEquals(List.of(w), mine.received());
        assertEquals(1, mine.receivedPeople());
        assertEquals(List.of(ref), mine.sent());
    }
}
