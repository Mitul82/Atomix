package com.springbootbackend.springbackend.consumer;

import java.nio.charset.StandardCharsets;
import java.util.List;

import org.springframework.amqp.AmqpRejectAndDontRequeueException;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.stereotype.Component;

import com.springbootbackend.springbackend.config.RabbitMqConfig;
import com.springbootbackend.springbackend.dto.ReservationEventPayload;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import tools.jackson.databind.ObjectMapper;

@Slf4j
@Component
@RequiredArgsConstructor
public class DeadLetterConsumer {
    private final StringRedisTemplate redisTemplate;
    private final ObjectMapper mapper;

    private static final DefaultRedisScript<Long> refundScript = new DefaultRedisScript<>(
        "if redis.call('SISMEMBER', KEYS[2], ARGV[1]) == 1 then " +
        "  redis.call('INCR', KEYS[1]); redis.call('SREM', KEYS[2], ARGV[1]); " +
        "  redis.call('DEL', KEYS[3]); redis.call('HINCRBY', KEYS[4], 'accepted_at_edge', -1); " +
        "  return 1; end; return 0;", Long.class
    );

    @RabbitListener(queues = RabbitMqConfig.dlqQueue)
    public void handleDeadLetterMessage(Message message) {
        String body = new String(message.getBody(), StandardCharsets.UTF_8);

        ReservationEventPayload p;

        try {
            p = mapper.readValue(body, ReservationEventPayload.class);
        } catch (Exception e) {
            log.error("[SPRING BACKEND] Unparseable dead letter, parking for manual review: {}", body, e);

            throw new AmqpRejectAndDontRequeueException("Unparseable dead letter", e);
        }

        log.error("[SPRING BACKEND] Poison message rejected for eventId={}, userId={}, idempotencyKey={}. Refunding Redis.", p.eventId(), p.userId(), p.idempotencyKey());

        List<String> keys = List.of(
            "atomix:event:" + p.eventId() + ":stock",
            "atomix:event:" + p.eventId() + ":buyers",
            "atomix:idemp:" + p.eventId() + ":" + p.userId() + ":" + p.idempotencyKey(),
            "atomix:event:" + p.eventId() + ":telemetry");

        Long refunded = redisTemplate.execute(refundScript, keys, p.userId());
        
        log.warn("[SPRING BACKEND] Refund result={} for eventId={}, userId={}", refunded, p.eventId(), p.userId());
    }
}