package com.hrms.attendance.enums;

public enum CheckInMethod {
    FACE_RECOGNITION, GPS, PIN, MANAGER_OVERRIDE, BIOMETRIC_DEVICE, MANUAL,
    /**
     * Checked in or out from the web app, with the browser's location (V143.53).
     * Accepted only while the company switched "Allow web check-in" on and the
     * migration that lets WEB into the records' method checks is applied
     * (PunchRulesService). Never face-verified.
     */
    WEB
}
