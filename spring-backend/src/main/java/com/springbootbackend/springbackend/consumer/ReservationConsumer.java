package com.springbootbackend.springbackend.consumer;

import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Component;

import com.springbootbackend.springbackend.config.RabbitMqConfig;
import com.springbootbackend.springbackend.dto.ReservationEventPayload;
import com.springbootbackend.springbackend.services.LedgerService;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

@Component
@RequiredArgsConstructor
@Slf4j  // ? this is a annotaion that is used to automatically generate a logger field at compile time
public class ReservationConsumer {
    private final LedgerService ledgerService;

    @RabbitListener(queues = RabbitMqConfig.queueName)
    public void handleReservationEvent(ReservationEventPayload payload) {
        try {
            ledgerService.processAtomicReservation(payload);
        } catch (DataIntegrityViolationException dupEx) {
            // * Unique constraint on idempotency_key caught a duplicate delivery; safe to ACK and ignore
            log.warn("[SPRING LEDGER] Duplicate reservation ignored via DB constraint for idempotencyKey={}", payload.idempotencyKey());
        } catch (Exception e) {
            log.error("[SPRING LEDGER] Failed to process reservation message for userId={}: ", payload.userId(), e);
            // * Rethrow so Spring AMQP retries 3 times and then routes to atomix.dlx -> reservation.dlq
            throw new RuntimeException(e);
        }
    }
}