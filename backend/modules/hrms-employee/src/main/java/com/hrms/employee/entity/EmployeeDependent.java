package com.hrms.employee.entity;

import com.hrms.core.entity.BaseEntity;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

import java.time.LocalDate;
import java.util.UUID;

@Entity
@Table(schema = "hrms", name = "employee_dependents")
@Getter
@Setter
public class EmployeeDependent extends BaseEntity {

    @Column(name = "employee_id", nullable = false)
    private UUID employeeId;

    @Column(name = "name", nullable = false, length = 150)
    private String name;

    @Column(name = "relationship", nullable = false, length = 50)
    private String relationship;

    @Column(name = "date_of_birth")
    private LocalDate dateOfBirth;

    @Column(name = "gender", length = 10)
    private String gender;

    @Column(name = "is_nominee", nullable = false)
    private boolean nominee = false;

    @Column(name = "nominee_percentage")
    private Integer nomineePercentage;
}
