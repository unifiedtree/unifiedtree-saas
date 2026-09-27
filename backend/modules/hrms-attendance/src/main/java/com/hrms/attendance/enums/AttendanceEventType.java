package com.hrms.attendance.enums;

public enum AttendanceEventType {
    CHECK_IN,
    CHECK_OUT,
    BREAK_START,
    BREAK_END,
    MANUAL_ENTRY,
    CORRECTION_REQUESTED,
    CORRECTION_APPROVED,
    CORRECTION_REJECTED,
    /**
     * A change to a punch that isn't a new punch, a manual entry or a fix
     * (the event_logs check has always allowed it): the employee took back
     * their own check-out within 10 minutes (V143.53, undo check-out).
     */
    MANUAL_OVERRIDE
}
