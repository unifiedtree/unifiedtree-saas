package com.hrms.hiring.dto;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.UUID;

/**
 * Everything the employee record needs from the hiring side when a HIRED
 * candidate is converted: who they are (candidate), where they go
 * (requisition company / department / employment type) and what was agreed
 * (the accepted offer's role, CTC and joining date — null when there is no
 * accepted offer on record).
 */
public record CandidateConversionFacts(
        UUID candidateId,
        String fullName,
        String email,
        String phone,
        UUID companyId,
        UUID departmentId,
        String employmentType,
        String roleTitle,
        LocalDate joiningDate,
        BigDecimal offeredCtc) {}
