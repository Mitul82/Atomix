package com.springbootbackend.springbackend.models;

import lombok.*;
import jakarta.persistence.*;

import java.util.UUID;
import java.time.Instant;

import com.springbootbackend.springbackend.enums.ReservationMode;
import com.springbootbackend.springbackend.enums.ReservationStatus;

@Entity
@Table(
    name = "reservations",
    indexes = {
        @Index(name = "idx_reservation_status_expires", columnList = "status, expiresAt"),
        @Index(name = "idx_reservation_event_mode", columnList = "eventId, mode")
    },
    uniqueConstraints = {
        @UniqueConstraint(name = "uk_reservations_idempotency_key", columnNames = "idempotency_key")
    }
)
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class Reservation {
    @Id
    private UUID id;

    @Column(nullable = false, name = "event_id")
    private String eventId;

    @Column(nullable = false, name = "user_id")
    private String userId;

    @Column(nullable = false, name = "idempotency_key")
    private String idempotencyKey;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private ReservationStatus status;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private ReservationMode mode;

    @Column(nullable = false)
    private Instant createdAt;

    @Column(nullable = false)
    private Instant expiresAt;
}