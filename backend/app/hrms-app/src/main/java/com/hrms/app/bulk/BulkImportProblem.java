package com.hrms.app.bulk;

/**
 * One problem (or warning) in an import file: the file's row number (the
 * header is row 1), the column it is about (the template's column name; null
 * when it is about the whole row) and a plain-English message.
 */
public record BulkImportProblem(int row, String column, String message) {}
