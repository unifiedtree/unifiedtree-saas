package com.hrms.employee.mapper;

import com.hrms.employee.dto.EmergencyContactRequest;
import com.hrms.employee.dto.EmergencyContactResponse;
import com.hrms.employee.entity.EmergencyContact;
import org.mapstruct.Mapper;
import org.mapstruct.Mapping;

@Mapper(componentModel = "spring")
public interface EmergencyContactMapper {

    @Mapping(target = "id", source = "id")
    @Mapping(target = "employeeId", source = "employeeId")
    @Mapping(target = "isPrimary", source = "primary")
    EmergencyContactResponse toResponse(EmergencyContact emergencyContact);

    @Mapping(target = "id", ignore = true)
    @Mapping(target = "tenantId", ignore = true)
    @Mapping(target = "employeeId", ignore = true)
    @Mapping(target = "createdAt", ignore = true)
    @Mapping(target = "updatedAt", ignore = true)
    @Mapping(target = "createdBy", ignore = true)
    @Mapping(target = "updatedBy", ignore = true)
    @Mapping(target = "version", ignore = true)
    @Mapping(target = "primary", source = "isPrimary")
    EmergencyContact toEntity(EmergencyContactRequest request);
}
