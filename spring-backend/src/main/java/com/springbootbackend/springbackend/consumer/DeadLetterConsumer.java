package com.springbootbackend.springbackend.consumer;

import java.util.List;

import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.stereotype.Component;

import com.springbootbackend.springbackend.config.RabbitMqConfig;
import com.springbootbackend.springbackend.dto.ReservationEventPayload;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

@Slf4j
@Component
@RequiredArgsConstructor
public class DeadLetterConsumer {
    private final StringRedisTemplate redisTemplate;

    private static final DefaultRedisScript<Long> dqlRefundScript = new DefaultRedisScript<>(
            "if redis.call('SISMEMBER', KEYS[2], ARGV[1]) == 1 then " +
            "  redis.call('INCR', KEYS[1]); " +
            "  redis.call('SREM', KEYS[2], ARGV[1]); " +
            "  redis.call('DEL', KEYS[3]); " +
            "  redis.call('HINCRBY', KEYS[4], 'accepted_at_edge', -1); " +
            "  return 1; " +
            "end; " +
            "return 0;",
            Long.class
    );

    @RabbitListener(queues = RabbitMqConfig.dlqQueue)
    public void handleDeadLetterMessage(ReservationEventPayload payload) {

        log.error("[DLQ] Poison message permanently rejected for eventId={}, userId={}, idempotencyKey={}. Triggering Redis refund.", payload.eventId(), payload.userId(), payload.idempotencyKey());

        try {
            String eventId = payload.eventId();
            String userId = payload.userId();
            String idempotencyKey = payload.idempotencyKey();

            List<String> keys = List.of(
                    "atomix:event:" + eventId + ":stock",
                    "atomix:event:" + eventId + ":buyers",
                    "atomix:idemp:" + idempotencyKey,
                    "atomix:event:" + eventId + ":telemetry"
            );

            Long refunded = redisTemplate.execute(dqlRefundScript, keys, userId);
            
            log.info("[DLQ] Refund script result={} for eventId={}, userId={}", refunded, eventId, userId);
        } catch (Exception e) {
            log.error("[CRITICAL] Failed to process dead-letter refund for payload: {}", payload, e);
        }
    }
}