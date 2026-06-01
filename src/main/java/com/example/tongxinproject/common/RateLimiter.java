package com.example.tongxinproject.common;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

/**
 * 简易内存限流器
 * 用于登录接口的暴力破解防护：同一key在15分钟内失败5次则锁定15分钟
 */
@Component
public class RateLimiter {

    private static final Logger log = LoggerFactory.getLogger(RateLimiter.class);

    private static final int MAX_ATTEMPTS = 5;
    private static final long WINDOW_MINUTES = 15;
    private static final long CLEANUP_INTERVAL_MINUTES = 10;

    private final Map<String, AttemptRecord> attempts = new ConcurrentHashMap<>();
    private final ScheduledExecutorService cleanupExecutor = Executors.newSingleThreadScheduledExecutor(r -> {
        Thread t = new Thread(r, "rate-limiter-cleanup");
        t.setDaemon(true);
        return t;
    });

    public RateLimiter() {
        // 定期清理过期记录
        cleanupExecutor.scheduleAtFixedRate(
                this::cleanup,
                CLEANUP_INTERVAL_MINUTES,
                CLEANUP_INTERVAL_MINUTES,
                TimeUnit.MINUTES
        );
    }

    /**
     * 记录一次失败尝试
     * @return true表示已被锁定，false表示未锁定
     */
    public boolean recordFailure(String key) {
        AttemptRecord record = attempts.computeIfAbsent(key, k -> new AttemptRecord());
        synchronized (record) {
            long now = System.currentTimeMillis();
            // 检查是否在锁定窗口内
            if (record.lockedUntil > now) {
                return true; // 已被锁定
            }
            record.count++;
            record.lastAttempt = now;
            if (record.count >= MAX_ATTEMPTS) {
                record.lockedUntil = now + TimeUnit.MINUTES.toMillis(WINDOW_MINUTES);
                log.warn("Rate limit triggered for key: {} ({} failures in {} min)", key, MAX_ATTEMPTS, WINDOW_MINUTES);
                return true;
            }
            return false;
        }
    }

    /**
     * 检查是否被锁定
     */
    public boolean isLocked(String key) {
        AttemptRecord record = attempts.get(key);
        if (record == null) return false;
        synchronized (record) {
            return record.lockedUntil > System.currentTimeMillis();
        }
    }

    /**
     * 获取剩余锁定时间（秒），0表示未锁定
     */
    public long getLockSecondsRemaining(String key) {
        AttemptRecord record = attempts.get(key);
        if (record == null) return 0;
        synchronized (record) {
            long remaining = record.lockedUntil - System.currentTimeMillis();
            return remaining > 0 ? TimeUnit.MILLISECONDS.toSeconds(remaining) : 0;
        }
    }

    /**
     * 重置某个key的记录（登录成功后调用）
     */
    public void reset(String key) {
        attempts.remove(key);
    }

    private void cleanup() {
        long cutoff = System.currentTimeMillis() - TimeUnit.MINUTES.toMillis(WINDOW_MINUTES * 2);
        attempts.entrySet().removeIf(entry -> {
            synchronized (entry.getValue()) {
                return entry.getValue().lastAttempt < cutoff && entry.getValue().lockedUntil < System.currentTimeMillis();
            }
        });
    }

    private static class AttemptRecord {
        int count = 0;
        long lastAttempt = 0;
        long lockedUntil = 0;
    }
}
