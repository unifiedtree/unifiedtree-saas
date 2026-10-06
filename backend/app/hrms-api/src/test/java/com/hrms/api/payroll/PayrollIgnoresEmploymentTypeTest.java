package com.hrms.api.payroll;

import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.regex.Pattern;
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Employment types (6 Oct 2026): a company may give people its own types (APPRENTICE, SEASONAL…). That is
 * safe for pay because payroll, leave and full-and-final never read the employment type — a person with a
 * company's own type is paid, accrues leave and settles exactly as a FULL_TIME person does. This keeps it
 * that way: if one of them starts branching on the type, it must map the company's own types first.
 */
class PayrollIgnoresEmploymentTypeTest {

    private static final Pattern TYPE = Pattern.compile("employment_type|employmentType|EmploymentType");

    @Test
    void payrollLeaveAndSettlementDoNotBranchOnTheEmploymentType() throws IOException {
        Path backend = Path.of("").toAbsolutePath().getParent().getParent(); // backend/app/hrms-api → backend
        List<Path> roots = List.of(
                backend.resolve("app/hrms-api/src/main/java/com/hrms/api/payroll"),
                backend.resolve("modules/hrms-payroll/src/main/java"),
                backend.resolve("modules/hrms-leave/src/main/java"),
                backend.resolve("modules/hrms-fnf/src/main/java"));
        int scanned = 0;
        for (Path root : roots) {
            assertThat(root).as("source folder").isDirectory();
            try (Stream<Path> files = Files.walk(root)) {
                for (Path f : files.filter(p -> p.toString().endsWith(".java")).toList()) {
                    scanned++;
                    assertThat(TYPE.matcher(Files.readString(f)).find())
                            .as("%s reads the employment type", backend.relativize(f))
                            .isFalse();
                }
            }
        }
        assertThat(scanned).isGreaterThan(20);
    }
}
