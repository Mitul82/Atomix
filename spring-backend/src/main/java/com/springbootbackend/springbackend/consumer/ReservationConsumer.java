package com.springbootbackend.springbackend.consumer;

import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.stereotype.Component;

import com.springbootbackend.springbackend.config.RabbitMqConfig;
import com.springbootbackend.springbackend.dto.ReservationEventPayload;
import com.springbootbackend.springbackend.services.LedgerService;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import tools.jackson.databind.ObjectMapper;

@Component
@RequiredArgsConstructor
@Slf4j  // ? this is a annotaion that is used to automatically generate a logger field at compile time
public class ReservationConsumer {
    private final LedgerService ledgerService;
    private final ObjectMapper mapper;

    @RabbitListener(queues = RabbitMqConfig.queueName)
    public void handleReservationEvent(String rawMessage) {
        try {
            ReservationEventPayload payload = mapper.readValue(rawMessage, ReservationEventPayload.class);

            ledgerService.processAtomicReservation(payload);
        } catch (Exception e) {
            log.error("[SPRING LEDGER] Failed to process reservation message: {}", rawMessage, e);

            throw new RuntimeException(e);
        }
    }
}