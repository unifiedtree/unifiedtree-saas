package com.unifiedtree.notifications.service;

import com.hrms.core.dto.PageResponse;
import com.unifiedtree.notifications.dto.NotificationDtos.NotificationDto;
import com.unifiedtree.notifications.entity.AppNotification;
import com.unifiedtree.notifications.enums.AppNotificationType;
import com.unifiedtree.notifications.repository.AppNotificationRepository;
import com.unifiedtree.notifications.repository.DeviceTokenRepository;
import com.unifiedtree.notifications.template.NotificationEventCatalog;
import org.junit.jupiter.api.Test;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/** Redesign BW-05: the list's optional {@code since} and each row's {@code group}. */
class NotificationListSinceTest {

    private final AppNotificationRepository repo = mock(AppNotificationRepository.class);
    private final AppNotificationService service = new AppNotificationService(repo, mock(DeviceTokenRepository.class), null, null);
    private final UUID user = UUID.randomUUID();
    private final PageRequest page = PageRequest.of(0, 50);

    private static AppNotification row(AppNotificationType type) {
        AppNotification n = new AppNotification();
        n.setId(UUID.randomUUID());
        n.setType(type);
        n.setTitle("t");
        n.setBody("b");
        n.setCreatedAt(Instant.now());
        return n;
    }

    @Test void withoutSinceTheListIsAsBefore() {
        when(repo.findByUserIdOrderByCreatedAtDesc(user, page)).thenReturn(new PageImpl<>(List.of(row(AppNotificationType.LEAVE_APPROVED))));
        PageResponse<NotificationDto> out = service.list(user, false, page);
        assertEquals(1, out.content().size());
        verify(repo).findByUserIdOrderByCreatedAtDesc(user, page);
        verify(repo, never()).findByUserIdAndCreatedAtGreaterThanEqualOrderByCreatedAtDesc(any(), any(), any());
    }

    @Test void sinceAsksOnlyForNewerRowsOfTheSameUser() {
        Instant since = Instant.parse("2026-09-25T00:00:00Z");
        Page<AppNotification> empty = new PageImpl<>(List.of());
        when(repo.findByUserIdAndCreatedAtGreaterThanEqualOrderByCreatedAtDesc(user, since, page)).thenReturn(empty);
        when(repo.findByUserIdAndReadAtIsNullAndCreatedAtGreaterThanEqualOrderByCreatedAtDesc(user, since, page)).thenReturn(empty);
        service.list(user, false, since, page);
        service.list(user, true, since, page);
        verify(repo).findByUserIdAndCreatedAtGreaterThanEqualOrderByCreatedAtDesc(user, since, page);
        verify(repo).findByUserIdAndReadAtIsNullAndCreatedAtGreaterThanEqualOrderByCreatedAtDesc(user, since, page);
        verify(repo, never()).findByUserIdOrderByCreatedAtDesc(any(), any());
    }

    @Test void everyRowCarriesItsCatalogGroup() {
        for (AppNotificationType t : AppNotificationType.values()) {
            NotificationDto dto = NotificationDto.from(row(t));
            assertEquals(NotificationEventCatalog.forType(t).group(), dto.group(), t.name());
            assertNotNull(dto.group(), t.name());
        }
        assertEquals("Leave", NotificationDto.from(row(AppNotificationType.LEAVE_SUBMITTED)).group());
        assertEquals("Expenses and advances", NotificationDto.from(row(AppNotificationType.EXPENSE_APPROVED)).group());
        assertEquals("Approvals", NotificationDto.from(row(AppNotificationType.DECISION_UNDONE)).group());
        assertEquals("Other", NotificationDto.from(row(AppNotificationType.GENERAL)).group());
    }
}
