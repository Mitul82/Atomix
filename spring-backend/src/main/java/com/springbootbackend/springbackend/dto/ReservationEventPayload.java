package com.springbootbackend.springbackend.dto;

public record ReservationEventPayload(
    String reservationId,
    String eventId,
    String userId,
    String idempotencyKey,
    String reservedAt
) {

}