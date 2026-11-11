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

    @Column(nullable = false)
    private String eventId;

    @Column(nullable = false)
    private String userId;

    @Column(nullable = false, unique = true)
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