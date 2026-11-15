package com.springbootbackend.springbackend.consumer;

import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Component;

import com.springbootbackend.springbackend.config.RabbitMqConfig;
import com.springbootbackend.springbackend.dto.ReservationEventPayload;
import com.springbootbackend.springbackend.repositories.ReservationRespository;
import com.springbootbackend.springbackend.services.LedgerService;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

@Component
@RequiredArgsConstructor
@Slf4j  // ? this is a annotaion that is used to automatically generate a logger field at compile time
public class ReservationConsumer {
    private final LedgerService ledgerService;
    private final ReservationRespository reservationRepo;

    @RabbitListener(queues = RabbitMqConfig.queueName)
    public void handleReservationEvent(ReservationEventPayload payload) {
        try {
            ledgerService.processAtomicReservation(payload);
        } catch (DataIntegrityViolationException ex) {
            if (reservationRepo.existsByIdempotencyKey(payload.idempotencyKey())) {
                log.warn("[SPRING LEDGER] Duplicate delivery ignored for idempotencyKey={}", payload.idempotencyKey());

                return;
            }

            log.error("[SPRING LEDGER] Constraint violation without an existing reservation, userId={}", payload.userId(), ex);

            throw ex;
        } catch (RuntimeException e) {
            log.error("[SPRING LEDGER] Failed to process reservation message for userId={}: ", payload.userId(), e);

            throw e;
        }
    }
}