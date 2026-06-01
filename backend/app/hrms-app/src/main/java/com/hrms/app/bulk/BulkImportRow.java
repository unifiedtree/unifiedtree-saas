package com.hrms.app.bulk;

import java.util.ArrayList;
import java.util.List;

public class BulkImportRow {

    private final int rowNumber;
    private String firstName;
    private String lastName;
    private String email;
    private String phone;
    private String departmentName;
    private String designationName;
    private String jobTitle;
    private String employmentType;
    private String dateOfJoining;
    private String gender;
    private String dateOfBirth;
    private String managerId;

    private final List<String> errors = new ArrayList<>();

    public BulkImportRow(int rowNumber) {
        this.rowNumber = rowNumber;
    }

    public void addError(String error) {
        errors.add("Row " + rowNumber + ": " + error);
    }

    public boolean hasErrors() {
        return !errors.isEmpty();
    }

    public int getRowNumber()            { return rowNumber; }
    public List<String> getErrors()      { return errors; }
    public String getFirstName()         { return firstName; }
    public void setFirstName(String v)   { this.firstName = v; }
    public String getLastName()          { return lastName; }
    public void setLastName(String v)    { this.lastName = v; }
    public String getEmail()             { return email; }
    public void setEmail(String v)       { this.email = v; }
    public String getPhone()             { return phone; }
    public void setPhone(String v)       { this.phone = v; }
    public String getDepartmentName()    { return departmentName; }
    public void setDepartmentName(String v) { this.departmentName = v; }
    public String getDesignationName()   { return designationName; }
    public void setDesignationName(String v) { this.designationName = v; }
    public String getJobTitle()          { return jobTitle; }
    public void setJobTitle(String v)    { this.jobTitle = v; }
    public String getEmploymentType()    { return employmentType; }
    public void setEmploymentType(String v) { this.employmentType = v; }
    public String getDateOfJoining()     { return dateOfJoining; }
    public void setDateOfJoining(String v) { this.dateOfJoining = v; }
    public String getGender()            { return gender; }
    public void setGender(String v)      { this.gender = v; }
    public String getDateOfBirth()       { return dateOfBirth; }
    public void setDateOfBirth(String v) { this.dateOfBirth = v; }
    public String getManagerId()         { return managerId; }
    public void setManagerId(String v)   { this.managerId = v; }
}
