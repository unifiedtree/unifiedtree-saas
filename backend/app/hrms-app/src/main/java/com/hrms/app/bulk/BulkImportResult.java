package com.hrms.app.bulk;

import java.util.List;

public record BulkImportResult(
        int totalRows,
        int successCount,
        int errorCount,
        List<String> errors,
        boolean committed
) {
    public static BulkImportResult validationFailed(int totalRows, List<String> errors) {
        return new BulkImportResult(totalRows, 0, errors.size(), errors, false);
    }

    public static BulkImportResult committed(int totalRows, int successCount) {
        return new BulkImportResult(totalRows, successCount, 0, List.of(), true);
    }
}
