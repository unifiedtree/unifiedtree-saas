package com.hrms.api.hiring;

import com.unifiedtree.notifications.events.InterviewNotificationEvent;
import com.unifiedtree.notifications.listener.InterviewNotificationText;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;

/** What the interviewers read: times in IST, and no product name anywhere. */
class InterviewNotificationTextTest {

    private static InterviewNotificationEvent event(String kind) {
        return new InterviewNotificationEvent(UUID.randomUUID(), UUID.randomUUID(), kind, List.of(UUID.randomUUID()),
                "Priya Sharma", "Senior Engineer", "Technical round", Instant.parse("2026-09-26T05:00:00Z"), 45, "VIDEO",
                "https://meet.example.com/abc");
    }

    @Test
    void scheduledMessageShowsIstTimeModeAndLink() {
        String body = InterviewNotificationText.body(event("SCHEDULED"));
        assertEquals("Priya Sharma for Senior Engineer · Technical round · Sat 26 Sep, 10:30 am IST (45 min) · Video call · https://meet.example.com/abc", body);
        assertEquals("You're interviewing a candidate", InterviewNotificationText.title("SCHEDULED"));
    }

    @Test
    void cancelledAndRemovedSayWhatHappened() {
        assertTrue(InterviewNotificationText.body(event("CANCELLED")).endsWith("It has been cancelled."));
        assertTrue(InterviewNotificationText.body(event("REMOVED")).endsWith("You have been taken off this interview."));
        assertEquals("Interview cancelled", InterviewNotificationText.title("CANCELLED"));
        assertEquals("Interview changed", InterviewNotificationText.title("RESCHEDULED"));
    }

    @Test
    void neverMentionsTheProductName() {
        for (String kind : List.of("SCHEDULED", "RESCHEDULED", "CANCELLED", "REMOVED")) {
            String text = InterviewNotificationText.title(kind) + " " + InterviewNotificationText.body(event(kind));
            assertFalse(text.toLowerCase().contains("unified"), text);
        }
    }
}
