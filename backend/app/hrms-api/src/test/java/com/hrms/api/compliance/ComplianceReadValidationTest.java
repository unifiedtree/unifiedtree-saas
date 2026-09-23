package com.hrms.api.compliance;

import com.hrms.compliance.dto.ComplianceItemResponse;
import com.hrms.compliance.dto.StatutoryFilingRequest;
import com.hrms.compliance.enums.ComplianceStatus;
import com.hrms.compliance.enums.FilingType;
import com.hrms.compliance.service.ComplianceService;
import com.hrms.compliance.service.PoshService;
import com.hrms.core.dto.PageResponse;
import com.hrms.employee.repository.EmployeeRepository;
import jakarta.validation.Validation;
import org.junit.jupiter.api.Test;
import org.springframework.data.domain.Pageable;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class ComplianceReadValidationTest {
    @Test void unassignedOwnerRemainsReadableWithoutAnEmployeeLookup() {
        UUID company = UUID.randomUUID();
        var service = mock(ComplianceService.class);
        var employees = mock(EmployeeRepository.class);
        var controller = new ComplianceController(service, mock(PoshService.class), employees);
        var page = Pageable.ofSize(20);
        var item = new ComplianceItemResponse(UUID.randomUUID(), company, "Unassigned obligation", "GENERAL",
                LocalDate.now(), ComplianceStatus.PENDING, "ONCE", null, null, null, "Local check", null);
        when(service.listItems(company, page)).thenReturn(new PageResponse<>(List.of(item), 0, 20, 1, 1, true));
        var result = controller.listItems(company, page).getBody();
        assertNotNull(result);
        assertEquals(item.id(), result.content().getFirst().id());
        assertNull(result.content().getFirst().ownerId());
        assertNull(result.content().getFirst().ownerName());
        verifyNoInteractions(employees);
    }

    @Test void oversizedFilingPeriodsFailValidationBeforeTheDatabase() {
        try (var factory = Validation.buildDefaultValidatorFactory()) {
            var validator = factory.getValidator();
            var valid = new StatutoryFilingRequest(UUID.randomUUID(), FilingType.OTHER, "x".repeat(20), BigDecimal.ZERO, LocalDate.now());
            var invalid = new StatutoryFilingRequest(UUID.randomUUID(), FilingType.OTHER, "x".repeat(21), BigDecimal.ZERO, LocalDate.now());
            assertTrue(validator.validate(valid).isEmpty());
            assertTrue(validator.validate(invalid).stream().anyMatch(v -> v.getPropertyPath().toString().equals("period")));
        }
    }
}
