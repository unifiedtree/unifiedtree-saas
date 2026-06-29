package com.hrms.document.enums;

/**
 * Employee document category.
 * Mirrors the VARCHAR(50) values in document_mgmt.employee_documents.
 */
public enum DocumentCategory {
    CONTRACT,
    ID_PROOF,
    CERTIFICATE,
    PAYSLIP,
    POLICY,
    TAX,
    OTHER
}
