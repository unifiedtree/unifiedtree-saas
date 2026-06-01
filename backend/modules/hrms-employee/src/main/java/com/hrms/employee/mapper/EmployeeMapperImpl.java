package com.hrms.employee.mapper;

import com.hrms.core.enums.EmploymentStatus;
import com.hrms.employee.dto.CreateEmployeeRequest;
import com.hrms.employee.dto.EmployeeResponse;
import com.hrms.employee.dto.EmployeeSummaryResponse;
import com.hrms.employee.entity.Employee;
import com.hrms.employee.enums.EmploymentType;
import com.hrms.employee.enums.Gender;
import java.math.BigDecimal;
import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;
import javax.annotation.processing.Generated;
import org.springframework.stereotype.Component;

@Generated(
    value = "org.mapstruct.ap.MappingProcessor",
    date = "2026-05-15T12:47:28+0530",
    comments = "version: 1.6.3, compiler: javac, environment: Java 21.0.11 (Eclipse Adoptium)"
)
@Component
public class EmployeeMapperImpl implements EmployeeMapper {

    @Override
    public EmployeeResponse toResponse(Employee employee) {
        if ( employee == null ) {
            return null;
        }

        UUID id = null;
        UUID tenantId = null;
        Instant createdAt = null;
        boolean isFaceEnrolled = false;
        String employeeCode = null;
        String firstName = null;
        String lastName = null;
        String email = null;
        String phone = null;
        LocalDate dateOfBirth = null;
        Gender gender = null;
        UUID companyId = null;
        UUID departmentId = null;
        UUID branchId = null;
        UUID managerId = null;
        String jobTitle = null;
        EmploymentType employmentType = null;
        EmploymentStatus employmentStatus = null;
        LocalDate dateOfJoining = null;
        String workLocation = null;
        String salaryFrequency = null;
        BigDecimal monthlySalary = null;
        String panNumber = null;
        String aadhaarNumber = null;
        String uanNumber = null;
        String esiNumber = null;
        String bankAccountNumber = null;
        String bankIfscCode = null;
        String bankName = null;
        String bankBranchName = null;
        String profilePhotoUrl = null;

        id = employee.getId();
        tenantId = employee.getTenantId();
        createdAt = employee.getCreatedAt();
        isFaceEnrolled = employee.isFaceEnrolled();
        employeeCode = employee.getEmployeeCode();
        firstName = employee.getFirstName();
        lastName = employee.getLastName();
        email = employee.getEmail();
        phone = employee.getPhone();
        dateOfBirth = employee.getDateOfBirth();
        gender = employee.getGender();
        companyId = employee.getCompanyId();
        departmentId = employee.getDepartmentId();
        branchId = employee.getBranchId();
        managerId = employee.getManagerId();
        jobTitle = employee.getJobTitle();
        employmentType = employee.getEmploymentType();
        employmentStatus = employee.getEmploymentStatus();
        dateOfJoining = employee.getDateOfJoining();
        workLocation = employee.getWorkLocation();
        salaryFrequency = employee.getSalaryFrequency();
        monthlySalary = employee.getMonthlySalary();
        panNumber = employee.getPanNumber();
        aadhaarNumber = employee.getAadhaarNumber();
        uanNumber = employee.getUanNumber();
        esiNumber = employee.getEsiNumber();
        bankAccountNumber = employee.getBankAccountNumber();
        bankIfscCode = employee.getBankIfscCode();
        bankName = employee.getBankName();
        bankBranchName = employee.getBankBranchName();
        profilePhotoUrl = employee.getProfilePhotoUrl();

        EmployeeResponse employeeResponse = new EmployeeResponse( id, tenantId, employeeCode, firstName, lastName, email, phone, dateOfBirth, gender, companyId, departmentId, branchId, managerId, jobTitle, employmentType, employmentStatus, dateOfJoining, workLocation, salaryFrequency, monthlySalary, panNumber, aadhaarNumber, uanNumber, esiNumber, bankAccountNumber, bankIfscCode, bankName, bankBranchName, isFaceEnrolled, profilePhotoUrl, createdAt );

        return employeeResponse;
    }

    @Override
    public EmployeeSummaryResponse toSummary(Employee employee) {
        if ( employee == null ) {
            return null;
        }

        UUID id = null;
        String employeeCode = null;
        String firstName = null;
        String lastName = null;
        String email = null;
        String jobTitle = null;
        UUID departmentId = null;
        EmploymentStatus employmentStatus = null;

        id = employee.getId();
        employeeCode = employee.getEmployeeCode();
        firstName = employee.getFirstName();
        lastName = employee.getLastName();
        email = employee.getEmail();
        jobTitle = employee.getJobTitle();
        departmentId = employee.getDepartmentId();
        employmentStatus = employee.getEmploymentStatus();

        EmployeeSummaryResponse employeeSummaryResponse = new EmployeeSummaryResponse( id, employeeCode, firstName, lastName, email, jobTitle, departmentId, employmentStatus );

        return employeeSummaryResponse;
    }

    @Override
    public Employee toEntity(CreateEmployeeRequest request) {
        if ( request == null ) {
            return null;
        }

        Employee employee = new Employee();

        employee.setFirstName( request.firstName() );
        employee.setLastName( request.lastName() );
        employee.setMiddleName( request.middleName() );
        employee.setEmail( request.email() );
        employee.setPersonalEmail( request.personalEmail() );
        employee.setPhone( request.phone() );
        employee.setDateOfBirth( request.dateOfBirth() );
        employee.setGender( request.gender() );
        employee.setCompanyId( request.companyId() );
        employee.setDepartmentId( request.departmentId() );
        employee.setBranchId( request.branchId() );
        employee.setManagerId( request.managerId() );
        employee.setJobTitle( request.jobTitle() );
        employee.setEmploymentType( request.employmentType() );
        employee.setDateOfJoining( request.dateOfJoining() );
        employee.setNoticePeriodDays( request.noticePeriodDays() );
        employee.setWorkLocation( request.workLocation() );
        employee.setSalaryFrequency( request.salaryFrequency() );
        employee.setMonthlySalary( request.monthlySalary() );
        employee.setPanNumber( request.panNumber() );
        employee.setAadhaarNumber( request.aadhaarNumber() );
        employee.setUanNumber( request.uanNumber() );
        employee.setEsiNumber( request.esiNumber() );
        employee.setBankAccountNumber( request.bankAccountNumber() );
        employee.setBankIfscCode( request.bankIfscCode() );
        employee.setBankName( request.bankName() );
        employee.setBankBranchName( request.bankBranchName() );

        return employee;
    }
}
