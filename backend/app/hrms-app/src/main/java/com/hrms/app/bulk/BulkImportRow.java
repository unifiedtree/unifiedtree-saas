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
    // Redesign BW-93: the Add-employee columns imports now accept.
    private String employeeCode;
    private String branch;
    private String reportingManager;
    private String pan;
    private String uan;
    private String esi;
    private String bankName;
    private String bankAccount;
    private String ifsc;

    private final List<String> errors = new ArrayList<>();
    private final List<BulkImportProblem> problems = new ArrayList<>();
    private final List<BulkImportProblem> warnings = new ArrayList<>();

    public BulkImportRow(int rowNumber) {
        this.rowNumber = rowNumber;
    }

    /** A problem that isn't tied to one column. */
    public void addError(String error) {
        addProblem(null, error);
    }

    /**
     * A problem that stops the import. It is kept twice: as today's flat
     * "Row N: message" string (older callers parse it) and as a structured
     * {row, column, message} for the redesigned import page.
     */
    public void addProblem(String column, String message) {
        errors.add("Row " + rowNumber + ": " + message);
        problems.add(new BulkImportProblem(rowNumber, column, message));
    }

    /** Worth a look, but the row still imports. */
    public void addWarning(String column, String message) {
        warnings.add(new BulkImportProblem(rowNumber, column, message));
    }

    public boolean hasErrors() {
        return !errors.isEmpty();
    }

    public int getRowNumber()            { return rowNumber; }
    public List<String> getErrors()      { return errors; }
    public List<BulkImportProblem> getProblems() { return problems; }
    public List<BulkImportProblem> getWarnings() { return warnings; }
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
    public String getEmployeeCode()      { return employeeCode; }
    public void setEmployeeCode(String v) { this.employeeCode = v; }
    public String getBranch()            { return branch; }
    public void setBranch(String v)      { this.branch = v; }
    public String getReportingManager()  { return reportingManager; }
    public void setReportingManager(String v) { this.reportingManager = v; }
    public String getPan()               { return pan; }
    public void setPan(String v)         { this.pan = v; }
    public String getUan()               { return uan; }
    public void setUan(String v)         { this.uan = v; }
    public String getEsi()               { return esi; }
    public void setEsi(String v)         { this.esi = v; }
    public String getBankName()          { return bankName; }
    public void setBankName(String v)    { this.bankName = v; }
    public String getBankAccount()       { return bankAccount; }
    public void setBankAccount(String v) { this.bankAccount = v; }
    public String getIfsc()              { return ifsc; }
    public void setIfsc(String v)        { this.ifsc = v; }
}
