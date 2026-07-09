package com.unifiedtree.notifications.repository;

import com.unifiedtree.notifications.entity.DeviceToken;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface DeviceTokenRepository extends JpaRepository<DeviceToken, UUID> {

    Optional<DeviceToken> findByUserIdAndExpoPushToken(UUID userId, String expoPushToken);

    List<DeviceToken> findByUserIdAndActiveTrue(UUID userId);

    /**
     * Returns rows for the same Expo token that belong to another user.
     * Used at register-device time to deactivate the previous holder when a
     * device physically changes hands (new user logs in on the same phone).
     */
    List<DeviceToken> findByExpoPushTokenAndUserIdNot(String expoPushToken, UUID userId);
}
