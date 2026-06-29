package com.hrms.compliance.enums;

/**
 * Statutory filing type. Mirrors the VARCHAR(30) values in
 * compliance_mgmt.statutory_filings.filing_type.
 */
public enum FilingType {
    PF,
    ESI,
    TDS,
    PT,
    GRATUITY,
    OTHER
}
