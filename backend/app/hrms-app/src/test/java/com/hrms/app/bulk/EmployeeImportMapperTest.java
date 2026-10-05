package com.hrms.app.bulk;

import com.hrms.employee.service.EmployeeContactGuard.Field;
import com.hrms.employee.service.EmployeeContactGuard.Owner;
import com.hrms.employee.workforce.entity.WorkforceEmployee;
import org.junit.jupiter.api.Test;

import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/** BW-93: import rows are checked and mapped onto the Add-employee request. */
class EmployeeImportMapperTest {

    private final UUID company = UUID.randomUUID();
    private final UUID sales = UUID.randomUUID();
    private final UUID engineer = UUID.randomUUID();
    private final UUID hq = UUID.randomUUID();
    private final UUID pune = UUID.randomUUID();
    private final UUID puneEast = UUID.randomUUID();
    private final UUID boss = UUID.randomUUID();

    private EmployeeImportMapper.Lookups lookups() {
        return new EmployeeImportMapper.Lookups(
                EmployeeImportMapper.index(Map.of(sales, "Sales & Marketing")),
                Set.of(EmployeeImportMapper.key("Old Team")),
                EmployeeImportMapper.index(Map.of(engineer, "Software Engineer")),
                List.of(new EmployeeImportMapper.Branch(hq, "Head Office", "HQ"),
                        new EmployeeImportMapper.Branch(pune, "Pune", "PUN1"),
                        new EmployeeImportMapper.Branch(puneEast, "Pune", "PUN2")),
                List.of(new EmployeeImportMapper.Manager(boss, "EMP-001", "Boss@Example.com"),
                        new EmployeeImportMapper.Manager(UUID.randomUUID(), "EMP-002", "twin@example.com"),
                        new EmployeeImportMapper.Manager(UUID.randomUUID(), "EMP-003", "TWIN@example.com")),
                Set.of("Taken@Example.com"),
                Set.of("EMP-050"));
    }

    private static BulkImportRow row(int n, String first, String last, String email) {
        BulkImportRow r = new BulkImportRow(n);
        r.setFirstName(first);
        r.setLastName(last);
        r.setEmail(email);
        return r;
    }

    private List<EmployeeImportMapper.Mapped> map(BulkImportRow... rows) {
        return EmployeeImportMapper.map(List.of(rows), company, lookups());
    }

    @Test
    void departmentByNameIgnoringCaseAndSpacesFixesTheDroppedDepartment() {
        BulkImportRow r = row(2, "Asha", "Rao", "asha@example.com");
        r.setDepartmentName("  sales   &  MARKETING ");
        var mapped = map(r);
        assertThat(mapped).hasSize(1);
        assertThat(mapped.get(0).request().departmentId()).isEqualTo(sales);
        assertThat(mapped.get(0).request().companyId()).isEqualTo(company);
    }

    @Test
    void anUnknownOrArchivedDepartmentStopsTheRow() {
        BulkImportRow unknown = row(2, "Asha", "Rao", "asha@example.com");
        unknown.setDepartmentName("Salez");
        BulkImportRow archived = row(3, "Ravi", "K", "ravi@example.com");
        archived.setDepartmentName("old team");
        assertThat(map(unknown, archived)).isEmpty();
        assertThat(unknown.getProblems()).containsExactly(new BulkImportProblem(2, "department", "department not found in this company: Salez"));
        assertThat(unknown.getErrors()).containsExactly("Row 2: department not found in this company: Salez");
        assertThat(archived.getProblems()).extracting(BulkImportProblem::message).containsExactly("department is archived in this company: old team");
    }

    @Test
    void anUnknownDesignationIsKeptAsTheJobTitleWithAWarningAndNothingIsCreated() {
        BulkImportRow known = row(2, "Asha", "Rao", "asha@example.com");
        known.setDesignationName("software engineer");
        BulkImportRow unknown = row(3, "Ravi", "K", "ravi@example.com");
        unknown.setDesignationName("Chief Tea Officer");
        var mapped = map(known, unknown);
        assertThat(mapped).hasSize(2);
        assertThat(mapped.get(0).request().designationId()).isEqualTo(engineer);
        assertThat(mapped.get(0).jobTitle()).isNull();
        assertThat(mapped.get(1).request().designationId()).isNull();
        assertThat(mapped.get(1).request().designation()).isNull();      // free text would create a designation
        assertThat(mapped.get(1).jobTitle()).isEqualTo("Chief Tea Officer");
        assertThat(unknown.getWarnings()).extracting(BulkImportProblem::column).containsExactly("designation");
        assertThat(unknown.hasErrors()).isFalse();
    }

    @Test
    void branchByCodeOrNameAndAmbiguousNamesNeedTheCode() {
        BulkImportRow byCode = row(2, "A", "B", "a@example.com");
        byCode.setBranch("hq");
        BulkImportRow byName = row(3, "C", "D", "c@example.com");
        byName.setBranch("head office");
        BulkImportRow twoPunes = row(4, "E", "F", "e@example.com");
        twoPunes.setBranch("Pune");
        BulkImportRow puneCode = row(5, "G", "H", "g@example.com");
        puneCode.setBranch("PUN2");
        BulkImportRow nowhere = row(6, "I", "J", "i@example.com");
        nowhere.setBranch("Mars");
        var mapped = map(byCode, byName, twoPunes, puneCode, nowhere);
        assertThat(mapped).extracting(m -> m.request().branchId()).containsExactly(hq, hq, puneEast);
        assertThat(twoPunes.getProblems()).extracting(BulkImportProblem::message).containsExactly("more than one branch matches, use its code: Pune");
        assertThat(nowhere.getProblems()).extracting(BulkImportProblem::column).containsExactly("branch");
    }

    @Test
    void managerByCodeOrEmail() {
        BulkImportRow byCode = row(2, "A", "B", "a@example.com");
        byCode.setReportingManager("emp-001");
        BulkImportRow byEmail = row(3, "C", "D", "c@example.com");
        byEmail.setReportingManager(" boss@example.com ");
        BulkImportRow twins = row(4, "E", "F", "e@example.com");
        twins.setReportingManager("twin@example.com");
        BulkImportRow nobody = row(5, "G", "H", "g@example.com");
        nobody.setReportingManager("EMP-999");
        BulkImportRow blank = row(6, "I", "J", "i@example.com");
        var mapped = map(byCode, byEmail, twins, nobody, blank);
        assertThat(mapped).extracting(m -> m.request().reportingManagerId()).containsExactly(boss, boss, null);
        assertThat(twins.getProblems()).extracting(BulkImportProblem::column).containsExactly("reporting_manager");
        assertThat(nobody.getProblems()).extracting(BulkImportProblem::column).containsExactly("reporting_manager");
    }

    @Test
    void todaysChecksKeepTheirWording() {
        BulkImportRow r = row(2, " ", null, "not-an-email");
        r.setDateOfJoining("01/09/2026");
        r.setEmploymentType("GIG");
        map(r);
        assertThat(r.getErrors()).containsExactly(
                "Row 2: first_name is required",
                "Row 2: last_name is required",
                "Row 2: email is invalid or missing",
                "Row 2: date_of_joining must be yyyy-MM-dd, got: 01/09/2026",
                "Row 2: employment_type invalid: GIG");
    }

    @Test
    void emailsAndCodesInUseOrTwiceInTheFile() {
        BulkImportRow taken = row(2, "A", "B", "taken@example.com");
        BulkImportRow first = row(3, "C", "D", "same@example.com");
        first.setEmployeeCode("NEW-1");
        BulkImportRow again = row(4, "E", "F", "SAME@example.com");
        again.setEmployeeCode("new-1");
        BulkImportRow usedCode = row(5, "G", "H", "g@example.com");
        usedCode.setEmployeeCode("emp-050");
        var mapped = map(taken, first, again, usedCode);
        assertThat(mapped).extracting(EmployeeImportMapper.Mapped::row).containsExactly(3);
        assertThat(taken.getErrors()).containsExactly("Row 2: email already exists: taken@example.com");
        assertThat(again.getProblems()).extracting(BulkImportProblem::column).containsExactly("email", "employee_code");
        assertThat(usedCode.getProblems()).extracting(BulkImportProblem::message).containsExactly("employee_code already in use: emp-050");
        assertThat(mapped.get(0).request().employeeCode()).isEqualTo("NEW-1");
    }

    @Test
    void aCodeEndingInTooManyDigitsIsRefused() {
        // 20 digits: the counter casts the tail to bigint (19 digits max), so letting this in used
        // to make the whole company's Add employee page answer 500.
        BulkImportRow tooLong = row(2, "A", "B", "a@example.com");
        tooLong.setEmployeeCode("EMP-12345678901234567890");
        // 18 digits still fits, and so does a code with no numeric tail at all.
        BulkImportRow fits = row(3, "C", "D", "c@example.com");
        fits.setEmployeeCode("EMP-123456789012345678");
        BulkImportRow plain = row(4, "E", "F", "e@example.com");
        plain.setEmployeeCode("EMP-0007");
        var mapped = map(tooLong, fits, plain);
        assertThat(tooLong.getProblems()).extracting(BulkImportProblem::message)
                .containsExactly("employee_code ends in more than 18 digits, which is too long to number: EMP-12345678901234567890");
        assertThat(fits.getProblems()).isEmpty();
        assertThat(plain.getProblems()).isEmpty();
        assertThat(mapped).extracting(EmployeeImportMapper.Mapped::row).containsExactly(3, 4);
    }

    @Test
    void identityAndBankFormatsAreTheAddEmployeeForms() {
        BulkImportRow good = row(2, "A", "B", "a@example.com");
        good.setPan("abcde1234f");
        good.setUan("1002 0030 0400");
        good.setEsi("1234567890");
        good.setBankAccount("123456789012");
        good.setIfsc("hdfc0001234");
        good.setBankName("HDFC Bank");
        BulkImportRow bad = row(3, "C", "D", "c@example.com");
        bad.setPan("ABC123");
        bad.setUan("12");
        bad.setEsi("12");
        bad.setBankAccount("12ab");
        bad.setIfsc("HDFC1234");
        var mapped = map(good, bad);
        assertThat(mapped).hasSize(1);
        var req = mapped.get(0).request();
        assertThat(req.panNumber()).isEqualTo("ABCDE1234F");
        assertThat(req.uan()).isEqualTo("100200300400");
        assertThat(req.esi()).isEqualTo("1234567890");
        assertThat(req.bankAccountNumber()).isEqualTo("123456789012");
        assertThat(req.bankIfsc()).isEqualTo("HDFC0001234");
        assertThat(req.bankName()).isEqualTo("HDFC Bank");
        assertThat(bad.getProblems()).extracting(BulkImportProblem::column).containsExactly("pan", "uan", "esi", "bank_account", "ifsc");
        // the account number is never echoed back in a message
        assertThat(bad.getErrors()).noneMatch(e -> e.contains("12ab"));
    }

    @Test
    void aFutureJoiningDateIsAllowedAndBlankMeansToday() {
        BulkImportRow future = row(2, "A", "B", "a@example.com");
        future.setDateOfJoining("2030-01-15");
        future.setEmploymentType("consultant");
        BulkImportRow blank = row(3, "C", "D", "c@example.com");
        blank.setEmploymentType("full time");
        var mapped = map(future, blank);
        assertThat(mapped).hasSize(2);
        assertThat(mapped.get(0).request().dateOfJoining()).isEqualTo(LocalDate.of(2030, 1, 15));
        assertThat(mapped.get(0).request().employmentType()).isEqualTo(WorkforceEmployee.EmploymentType.CONSULTANT);
        assertThat(mapped.get(1).request().dateOfJoining()).isEqualTo(LocalDate.now(ZoneId.of("Asia/Kolkata")));
        assertThat(mapped.get(1).request().employmentType()).isEqualTo(WorkforceEmployee.EmploymentType.FULL_TIME);
    }

    @Test
    void theRequestIsTheAddEmployeeOneWithNothingSalaryOrAadhaar() {
        BulkImportRow r = row(2, " Asha ", "Rao", "asha@example.com");
        r.setGender("female");
        r.setDateOfBirth("1990-05-06");
        r.setPhone("9876543210");
        var req = map(r).get(0).request();
        assertThat(req.firstName()).isEqualTo("Asha");
        assertThat(req.gender()).isEqualTo(WorkforceEmployee.Gender.FEMALE);
        assertThat(req.dateOfBirth()).isEqualTo(LocalDate.of(1990, 5, 6));
        assertThat(req.employeeCode()).isNull();          // the company's next code
        assertThat(req.aadhaarNumber()).isNull();
        assertThat(req.monthlySalary()).isNull();
        assertThat(req.ctcAnnual()).isNull();
        assertThat(req.weeklyOffDays()).isNull();          // the company's weekly offs
        assertThat(req.roleCode()).isNull();
    }

    @Test
    void anUnknownGenderIsAWarningAndABadBirthDateAProblem() {
        BulkImportRow r = row(2, "A", "B", "a@example.com");
        r.setGender("x");
        BulkImportRow d = row(3, "C", "D", "c@example.com");
        d.setDateOfBirth("06-05-1990");
        var mapped = map(r, d);
        assertThat(mapped).extracting(EmployeeImportMapper.Mapped::row).containsExactly(2);
        assertThat(mapped.get(0).request().gender()).isNull();
        assertThat(r.getWarnings()).extracting(BulkImportProblem::column).containsExactly("gender");
        assertThat(d.getProblems()).extracting(BulkImportProblem::column).containsExactly("date_of_birth");
    }

    // ── The workspace's email rule (EmployeeContactGuard), 2026-10-05 ─────────

    private final Owner aisha = new Owner(UUID.randomUUID(), "Aisha Khan", "EMP-0003", false, Field.WORK);
    private final Owner leftPerson = new Owner(UUID.randomUUID(), "Old Timer", "EMP-0001", true, Field.WORK);
    private final Owner ravisHome = new Owner(UUID.randomUUID(), "Ravi K", "EMP-0004", false, Field.PERSONAL);

    private EmployeeImportMapper.Lookups owners(boolean reveal) {
        EmployeeImportMapper.Lookups l = lookups();
        return new EmployeeImportMapper.Lookups(l.activeDepartments(), l.inactiveDepartments(), l.designations(), l.branches(),
                l.managers(), Set.of("aisha@example.com", "old@example.com", "ravi.home@gmail.com"), l.codesInUse(),
                Map.of("aisha@example.com", aisha, "old@example.com", leftPerson, "ravi.home@gmail.com", ravisHome),
                Map.of("9845012345", List.of(aisha)), reveal);
    }

    @Test
    void anEmailSomeoneHasNamesThemWhateverItsCaseOrSpaces() {
        BulkImportRow r = row(2, "A", "B", "  AISHA@Example.com ");
        BulkImportRow left = row(3, "C", "D", "old@example.com");
        BulkImportRow personal = row(4, "E", "F", "Ravi.Home@gmail.com");
        var mapped = EmployeeImportMapper.map(List.of(r, left, personal), company, owners(true));
        assertThat(mapped).isEmpty();
        assertThat(r.getProblems()).containsExactly(new BulkImportProblem(2, "email",
                "email already belongs to Aisha Khan (EMP-0003): aisha@example.com"));
        assertThat(left.getProblems()).extracting(BulkImportProblem::message)
                .containsExactly("email already belongs to Old Timer (EMP-0001), who has left: old@example.com");
        assertThat(personal.getProblems()).extracting(BulkImportProblem::message)
                .containsExactly("email is already the personal email of Ravi K (EMP-0004): ravi.home@gmail.com");
    }

    @Test
    void withoutTheRightToSeeThePeopleTheProblemNamesNobody() {
        BulkImportRow r = row(2, "A", "B", "aisha@example.com");
        EmployeeImportMapper.map(List.of(r), company, owners(false));
        assertThat(r.getProblems()).extracting(BulkImportProblem::message)
                .containsExactly("email already used by another employee in this workspace: aisha@example.com");
    }

    @Test
    void theSameEmailTwiceInTheFileIsCaughtWhateverItsCaseOrSpaces() {
        BulkImportRow first = row(2, "A", "B", "new@example.com");
        BulkImportRow again = row(3, "C", "D", " New@Example.COM  ");
        var mapped = EmployeeImportMapper.map(List.of(first, again), company, owners(true));
        assertThat(mapped).extracting(EmployeeImportMapper.Mapped::row).containsExactly(2);
        assertThat(again.getProblems()).extracting(BulkImportProblem::message)
                .containsExactly("email appears more than once in this file (also row 2): new@example.com");
    }

    @Test
    void emailsAreSavedTrimmedAndLowerCased() {
        var mapped = EmployeeImportMapper.map(List.of(row(2, "A", "B", "  Fresh.Person@Example.com ")), company, owners(true));
        assertThat(mapped.get(0).request().email()).isEqualTo("fresh.person@example.com");
    }

    @Test
    void aSharedPhoneIsAWarningAndTheRowIsStillImported() {
        BulkImportRow known = row(2, "A", "B", "a@example.com");
        known.setPhone("+91 98450 12345");
        BulkImportRow twice = row(3, "C", "D", "c@example.com");
        twice.setPhone("98450-12345");
        BulkImportRow fresh = row(4, "E", "F", "e@example.com");
        fresh.setPhone("9000000001");
        var mapped = EmployeeImportMapper.map(List.of(known, twice, fresh), company, owners(true));
        assertThat(mapped).extracting(EmployeeImportMapper.Mapped::row).containsExactly(2, 3, 4);
        assertThat(known.getWarnings()).extracting(BulkImportProblem::message).containsExactly("Also used by Aisha Khan (EMP-0003).");
        assertThat(twice.getWarnings()).extracting(BulkImportProblem::message)
                .containsExactly("Also used by Aisha Khan (EMP-0003).", "phone is also on row 2 of this file");
        assertThat(fresh.getWarnings()).isEmpty();
    }
}
