package com.hrms.app.bulk;

import java.util.List;
import java.util.UUID;

/**
 * An import check or commit. The first five fields are unchanged (the web page
 * and older callers read them); the redesign (BW-93, BW-94) adds the problems
 * and warnings per row and column, and the people a commit created with the
 * onboarding each one got.
 */
public record BulkImportResult(
        int totalRows,
        int successCount,
        int errorCount,
        List<String> errors,
        boolean committed,
        /** Every problem that stops the import, one per row and column. */
        List<BulkImportProblem> problems,
        /** Things worth a look that don't stop the import. */
        List<BulkImportProblem> warnings,
        /** The people a commit created, in file order (empty otherwise). */
        List<CreatedRow> created
) {
    /**
     * One person the import created.
     *
     * @param onboarding       the onboarding run started for them (null when none was)
     * @param onboardingStatus STARTED, NO_CHECKLIST, NOT_ALLOWED or FAILED; null when onboarding wasn't asked for
     */
    public record CreatedRow(int row, UUID employeeId, String employeeCode, String name,
                             Onboarding onboarding, String onboardingStatus) {
        public CreatedRow withOnboarding(Onboarding started, String status) {
            return new CreatedRow(row, employeeId, employeeCode, name, started, status);
        }
    }

    public record Onboarding(UUID instanceId, String templateName) {}

    public static BulkImportResult validationFailed(int totalRows, List<String> errors) {
        return new BulkImportResult(totalRows, 0, errors.size(), errors, false, List.of(), List.of(), List.of());
    }

    public static BulkImportResult checked(int totalRows, List<String> errors,
                                           List<BulkImportProblem> problems, List<BulkImportProblem> warnings) {
        return new BulkImportResult(totalRows, 0, errors.size(), errors, false, problems, warnings, List.of());
    }

    public static BulkImportResult committed(int totalRows, int successCount) {
        return new BulkImportResult(totalRows, successCount, 0, List.of(), true, List.of(), List.of(), List.of());
    }

    public static BulkImportResult committed(int totalRows, List<BulkImportProblem> warnings, List<CreatedRow> created) {
        return new BulkImportResult(totalRows, created.size(), 0, List.of(), true, List.of(), warnings, created);
    }

    public BulkImportResult withCreated(List<CreatedRow> rows) {
        return new BulkImportResult(totalRows, successCount, errorCount, errors, committed, problems, warnings, rows);
    }
}
