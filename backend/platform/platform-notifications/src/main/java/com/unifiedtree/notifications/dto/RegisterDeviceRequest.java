package com.unifiedtree.notifications.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * POST /v1/notifications/register-device body.
 *
 * <p>{@code expoPushToken} is the string returned by
 * {@code Notifications.getExpoPushTokenAsync()} on the mobile client
 * (e.g. {@code ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]}).
 */
public record RegisterDeviceRequest(
        @NotBlank(message = "expoPushToken is required")
        @Size(max = 500)
        String expoPushToken,

        @Size(max = 20)
        String platform,

        @Size(max = 120)
        String deviceName,

        @Size(max = 30)
        String appVersion
) {}
