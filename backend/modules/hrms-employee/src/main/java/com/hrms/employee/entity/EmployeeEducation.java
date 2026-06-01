package com.hrms.employee.entity;

import com.hrms.core.entity.BaseEntity;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

import java.util.UUID;

@Entity
@Table(schema = "hrms", name = "employee_education")
@Getter
@Setter
public class EmployeeEducation extends BaseEntity {

    @Column(name = "employee_id", nullable = false)
    private UUID employeeId;

    @Column(name = "degree", nullable = false, length = 150)
    private String degree;

    @Column(name = "field_of_study", length = 150)
    private String fieldOfStudy;

    @Column(name = "institution", nullable = false, length = 255)
    private String institution;

    @Column(name = "start_year")
    private Integer startYear;

    @Column(name = "pass_year")
    private Integer endYear;

    @Column(name = "grade", length = 20)
    private String gradeOrPercentage;

    @Column(name = "is_highest", nullable = false)
    private boolean highest = false;
}
