package com.hrms.api.leave;

import com.hrms.core.exception.ResourceNotFoundException;
import com.hrms.core.tenant.TenantContext;
import com.unifiedtree.settings.dto.SettingsDtos.HolidayResponse;
import com.unifiedtree.settings.entity.Holiday;
import com.unifiedtree.settings.repository.HolidayRepository;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.time.LocalDate;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

/** Editing a holiday (BW-46): its own fields only, active holidays of this workspace only. */
class HolidayEditServiceTest {

    private final UUID tenant = UUID.randomUUID(), company = UUID.randomUUID(), id = UUID.randomUUID();
    private HolidayRepository repository;
    private HolidayEditService service;
    private Holiday holiday;

    @BeforeEach void setUp() {
        TenantContext.setTenantId(tenant);
        repository = mock(HolidayRepository.class);
        service = new HolidayEditService(repository);
        holiday = new Holiday();
        holiday.setId(id);
        holiday.setTenantId(tenant);
        holiday.setCompanyId(company);
        holiday.setHolidayDate(LocalDate.of(2026, 10, 2));
        holiday.setYear(2026);
        holiday.setHolidayName("Gandhi Jayanti");
        holiday.setHolidayType(Holiday.HolidayType.NATIONAL);
        holiday.setDescription("Office closed");
        holiday.setActive(true);
        when(repository.findById(id)).thenReturn(Optional.of(holiday));
        when(repository.save(any(Holiday.class))).thenAnswer(inv -> inv.getArgument(0));
    }

    @AfterEach void clear() { TenantContext.clear(); }

    @Test void theDateNameTypeAndDescriptionChangeAndTheCompanyStays() {
        HolidayResponse r = service.update(id, new HolidayEditService.UpdateHolidayRequest(
                LocalDate.of(2027, 1, 26), "  Republic Day ", Holiday.HolidayType.FESTIVAL, " Flag hoisting "));
        assertEquals(LocalDate.of(2027, 1, 26), r.holidayDate());
        assertEquals(2027, r.year(), "the year follows the date");
        assertEquals("Republic Day", r.holidayName());
        assertEquals(Holiday.HolidayType.FESTIVAL, r.holidayType());
        assertEquals("Flag hoisting", r.description());
        assertEquals(company, r.companyId());
        assertTrue(r.active());
        verify(repository).save(holiday);
    }

    @Test void noTypeKeepsTheTypeAndABlankDescriptionClearsIt() {
        HolidayResponse r = service.update(id, new HolidayEditService.UpdateHolidayRequest(
                LocalDate.of(2026, 10, 2), "Gandhi Jayanti", null, "  "));
        assertEquals(Holiday.HolidayType.NATIONAL, r.holidayType());
        assertNull(r.description());
    }

    @Test void archivedOrAnotherWorkspacesHolidaysCantBeEdited() {
        var req = new HolidayEditService.UpdateHolidayRequest(LocalDate.of(2026, 10, 3), "X", null, null);
        holiday.setActive(false);
        assertThrows(ResourceNotFoundException.class, () -> service.update(id, req));
        holiday.setActive(true);
        holiday.setTenantId(UUID.randomUUID());
        assertThrows(ResourceNotFoundException.class, () -> service.update(id, req));
        when(repository.findById(id)).thenReturn(Optional.empty());
        assertThrows(ResourceNotFoundException.class, () -> service.update(id, req));
        verify(repository, never()).save(any());
    }
}
