package com.hrms.employee.entity;

import com.hrms.core.entity.BaseEntity;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

import java.util.UUID;

@Entity
@Table(schema = "hrms", name = "employee_addresses")
@Getter
@Setter
public class EmployeeAddress extends BaseEntity {

    @Column(name = "employee_id", nullable = false)
    private UUID employeeId;

    @Column(name = "address_type", nullable = false, length = 20)
    private String addressType = "CURRENT";

    @Column(name = "line1", length = 255)
    private String line1;

    @Column(name = "line2", length = 255)
    private String line2;

    @Column(name = "city", length = 100)
    private String city;

    @Column(name = "state", length = 100)
    private String state;

    @Column(name = "country", length = 50)
    private String country = "India";

    @Column(name = "pincode", length = 15)
    private String pincode;
}
