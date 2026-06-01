package com.hrms.tenant.mapper;

import com.hrms.tenant.dto.DepartmentRequest;
import com.hrms.tenant.dto.DepartmentResponse;
import com.hrms.tenant.entity.Department;
import java.util.UUID;
import javax.annotation.processing.Generated;
import org.springframework.stereotype.Component;

@Generated(
    value = "org.mapstruct.ap.MappingProcessor",
    date = "2026-05-15T12:47:24+0530",
    comments = "version: 1.6.3, compiler: javac, environment: Java 21.0.11 (Eclipse Adoptium)"
)
@Component
public class DepartmentMapperImpl implements DepartmentMapper {

    @Override
    public Department toEntity(DepartmentRequest request) {
        if ( request == null ) {
            return null;
        }

        Department department = new Department();

        department.setName( request.name() );
        department.setCode( request.code() );
        department.setCompanyId( request.companyId() );
        department.setParentDepartmentId( request.parentDepartmentId() );
        department.setDescription( request.description() );
        department.setColorHex( request.colorHex() );
        department.setIconKey( request.iconKey() );

        department.setActive( true );

        return department;
    }

    @Override
    public DepartmentResponse toResponse(Department department) {
        if ( department == null ) {
            return null;
        }

        boolean isActive = false;
        UUID id = null;
        String name = null;
        String code = null;
        UUID companyId = null;
        UUID parentDepartmentId = null;
        UUID headEmployeeId = null;
        String description = null;
        String colorHex = null;
        String iconKey = null;

        isActive = department.isActive();
        id = department.getId();
        name = department.getName();
        code = department.getCode();
        companyId = department.getCompanyId();
        parentDepartmentId = department.getParentDepartmentId();
        headEmployeeId = department.getHeadEmployeeId();
        description = department.getDescription();
        colorHex = department.getColorHex();
        iconKey = department.getIconKey();

        DepartmentResponse departmentResponse = new DepartmentResponse( id, name, code, companyId, parentDepartmentId, headEmployeeId, isActive, description, colorHex, iconKey );

        return departmentResponse;
    }

    @Override
    public void updateEntity(DepartmentRequest request, Department department) {
        if ( request == null ) {
            return;
        }

        department.setName( request.name() );
        department.setCode( request.code() );
        department.setCompanyId( request.companyId() );
        department.setParentDepartmentId( request.parentDepartmentId() );
        department.setDescription( request.description() );
        department.setColorHex( request.colorHex() );
        department.setIconKey( request.iconKey() );
    }
}
