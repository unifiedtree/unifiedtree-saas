package com.hrms.api.ess.around;

import com.unifiedtree.notifications.service.NotificationDispatcher;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.util.Map;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

/** The person who was wished is told who wished them and what they wrote; tapping it opens Celebrations. */
class CelebrationWishNotifierTest {

    @Test
    @SuppressWarnings("unchecked")
    void thePersonIsToldWhoWishedThemAndTheMessage() {
        NotificationDispatcher dispatcher = mock(NotificationDispatcher.class);
        UUID tenant = UUID.randomUUID(), wish = UUID.randomUUID(), to = UUID.randomUUID(), from = UUID.randomUUID();
        new CelebrationWishNotifier(dispatcher).onWish(new CelebrationWishSentEvent(tenant, wish, to, from, "Priya Rao",
                CelebrationWishService.Occasion.ANNIVERSARY, "Congratulations on 5 years!"));

        ArgumentCaptor<Map<String, String>> values = ArgumentCaptor.forClass(Map.class);
        ArgumentCaptor<Map<String, Object>> data = ArgumentCaptor.forClass(Map.class);
        verify(dispatcher).dispatch(eq(tenant), eq(to), eq("people.celebration_wish"), values.capture(), data.capture());
        assertEquals("Priya Rao", values.getValue().get("senderName"));
        assertEquals("wished you a happy work anniversary", values.getValue().get("occasionText"));
        assertEquals("Congratulations on 5 years!", values.getValue().get("message"));
        assertEquals("CELEBRATION_WISH", data.getValue().get("type"));
        assertEquals("/milestones", data.getValue().get("route"));
        assertEquals(wish.toString(), data.getValue().get("wishId"));
        assertEquals(from.toString(), data.getValue().get("fromEmployeeId"));
        assertEquals("ANNIVERSARY", data.getValue().get("occasion"));
    }

    @Test
    void aFailedSendIsLoggedNotThrown() {
        NotificationDispatcher dispatcher = mock(NotificationDispatcher.class);
        when(dispatcher.dispatch(any(), any(), anyString(), any(), any())).thenThrow(new IllegalStateException("down"));
        new CelebrationWishNotifier(dispatcher).onWish(new CelebrationWishSentEvent(UUID.randomUUID(), UUID.randomUUID(),
                UUID.randomUUID(), UUID.randomUUID(), "Priya", CelebrationWishService.Occasion.WELCOME, "Welcome aboard!"));
        verify(dispatcher).dispatch(any(), any(), eq("people.celebration_wish"), any(), any());
    }
}
