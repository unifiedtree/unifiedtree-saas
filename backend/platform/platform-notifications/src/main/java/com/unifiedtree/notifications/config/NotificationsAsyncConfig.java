package com.unifiedtree.notifications.config;

import org.springframework.boot.web.client.RestTemplateBuilder;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.task.TaskExecutor;
import org.springframework.scheduling.annotation.EnableAsync;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;
import org.springframework.web.client.RestTemplate;

import java.time.Duration;

/**
 * Bounded async executor for Expo push HTTP calls.
 *
 * <p>The user-facing HTTP request that triggered a notification must NEVER
 * block on Expo's push endpoint (which can take up to ~10s). Every push is
 * dispatched through {@code notificationExecutor}; if the queue is saturated
 * the request is dropped and logged, not blocked.
 *
 * <p>Sizes chosen conservatively: 2-8 threads, 200 queue. A leave-approve
 * burst on a 200-person tenant generates at most one send per approver — never
 * enough to overflow.
 */
@Configuration
@EnableAsync
public class NotificationsAsyncConfig {

    @Bean(name = "notificationExecutor")
    public TaskExecutor notificationExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(2);
        executor.setMaxPoolSize(8);
        executor.setQueueCapacity(200);
        executor.setThreadNamePrefix("notif-push-");
        executor.setKeepAliveSeconds(60);
        // If both pool + queue are full, drop the task and log. Never block the
        // caller thread — that would defeat the whole point of async push.
        executor.setRejectedExecutionHandler((r, ex) ->
                org.slf4j.LoggerFactory.getLogger(NotificationsAsyncConfig.class)
                        .warn("notificationExecutor saturated; push dropped"));
        executor.initialize();
        return executor;
    }

    /**
     * Dedicated RestTemplate for Expo. 5s connect / 10s read is enough for
     * the Expo push endpoint under normal conditions and short enough that a
     * stalled Expo call cannot pin an executor thread indefinitely.
     */
    @Bean(name = "expoPushRestTemplate")
    public RestTemplate expoPushRestTemplate(RestTemplateBuilder builder) {
        return builder
                .setConnectTimeout(Duration.ofSeconds(5))
                .setReadTimeout(Duration.ofSeconds(10))
                .build();
    }
}
