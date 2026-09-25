package com.unifiedtree.notifications.service;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** A template title filled with long values must still fit notif.notifications.title (VARCHAR 300). */
class AppNotificationTitleTest {

    @Test
    void shortTitlesAreKept() {
        assertEquals("Leave approved", AppNotificationService.clampTitle("Leave approved"));
        assertNull(AppNotificationService.clampTitle(null));
        String exact = "x".repeat(AppNotificationService.TITLE_MAX);
        assertEquals(exact, AppNotificationService.clampTitle(exact));
    }

    @Test
    void longTitlesAreCutToFitWithAnEllipsis() {
        String cut = AppNotificationService.clampTitle("a ".repeat(400));
        assertTrue(cut.length() <= AppNotificationService.TITLE_MAX, "length " + cut.length());
        assertTrue(cut.endsWith("\u2026"));
    }
}
