package com.hrms.app.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.task.TaskExecutor;
import org.springframework.scheduling.annotation.EnableAsync;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

import java.util.concurrent.Executor;
import java.util.concurrent.ThreadPoolExecutor;

@Configuration
@EnableAsync
public class AsyncConfig {

    /**
     * Default executor for any bare {@code @Async} (no qualifier), and for
     * Spring MVC async request handling.
     *
     * <p><b>Why this bean has to exist.</b> Boot 3's auto-configured
     * {@code applicationTaskExecutor} is {@code @ConditionalOnMissingBean(
     * Executor.class)}. The moment ANY {@code Executor} bean is declared
     * (like the three below) it backs off — and there is no other bean named
     * {@code taskExecutor} in the app. So without this bean, bare
     * {@code @Async} fell through to {@code SimpleAsyncTaskExecutor}: a NEW
     * platform thread per invocation, no cap, no queue.
     *
     * <p>Concrete failure mode of the old behaviour: {@code AuditService.recordAsync}
     * is {@code @Transactional(REQUIRES_NEW)}, so every spawned thread grabs
     * a pool connection. A burst of audited writes spawned unbounded threads
     * that all blocked on a 10-connection pool; the JVM either hit native
     * thread limits or ran out of stack space (~1MB per thread) long before
     * Hikari drained. It also silently disabled MVC async request handling's
     * bounded executor.
     *
     * <p>{@code CallerRunsPolicy}: when both pool and queue saturate, run the
     * task on the caller's thread. That backpressures the caller instead of
     * losing the task; for our workload (audit writes, welcome emails), a
     * blocked publisher for 100ms is strictly better than a silently dropped
     * audit record.
     */
    @Bean(name = "taskExecutor")
    public TaskExecutor taskExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(4);
        executor.setMaxPoolSize(16);
        executor.setQueueCapacity(500);
        executor.setThreadNamePrefix("app-async-");
        executor.setRejectedExecutionHandler(new ThreadPoolExecutor.CallerRunsPolicy());
        executor.setWaitForTasksToCompleteOnShutdown(true);
        executor.setAwaitTerminationSeconds(30);
        executor.initialize();
        return executor;
    }

    @Bean(name = "analyticsExecutor")
    public Executor analyticsExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(2);
        executor.setMaxPoolSize(8);
        executor.setQueueCapacity(50);
        executor.setThreadNamePrefix("analytics-");
        executor.initialize();
        return executor;
    }

    /**
     * Dedicated pool for sending invitation / password-reset emails out of band,
     * so a slow or unreachable SMTP server never blocks the request thread. Drains
     * in-flight sends on shutdown so a queued invite isn't silently dropped.
     */
    @Bean(name = "invitationEmailExecutor")
    public Executor invitationEmailExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(2);
        executor.setMaxPoolSize(5);
        executor.setQueueCapacity(50);
        executor.setThreadNamePrefix("invite-email-");
        // 2026-09-17: no rejection handler here used to fall through to
        // AbortPolicy — a 500-person tenant bulk-inviting employees would
        // overflow this queue in seconds and the 51st invite would throw
        // TaskRejectedException with only a stack trace to prove it existed.
        // Prefer CallerRunsPolicy so the sender is briefly blocked instead
        // of quietly losing invites.
        executor.setRejectedExecutionHandler(new ThreadPoolExecutor.CallerRunsPolicy());
        executor.setWaitForTasksToCompleteOnShutdown(true);
        executor.setAwaitTerminationSeconds(30);
        executor.initialize();
        return executor;
    }

    /**
     * Dedicated pool for bulk letter distribution: generates a personalized PDF
     * per recipient and emails it out of band. Drains in-flight sends on shutdown
     * so a queued distribution recipient isn't silently dropped.
     */
    @Bean(name = "letterDistributionExecutor")
    public Executor letterDistributionExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(2);
        executor.setMaxPoolSize(4);
        executor.setQueueCapacity(50);
        executor.setThreadNamePrefix("letter-dist-");
        // Same reasoning as invitationEmailExecutor — a large distribution
        // overflows a 50-slot queue and the extra recipients used to vanish
        // with only a stack trace to prove they ever existed.
        executor.setRejectedExecutionHandler(new ThreadPoolExecutor.CallerRunsPolicy());
        executor.setWaitForTasksToCompleteOnShutdown(true);
        executor.setAwaitTerminationSeconds(30);
        executor.initialize();
        return executor;
    }
}
