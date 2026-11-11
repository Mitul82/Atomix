package com.springbootbackend.springbackend.repositories;

import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;

import com.springbootbackend.springbackend.models.Reservation;

import java.time.Instant;
import java.util.List;

import com.springbootbackend.springbackend.enums.ReservationMode;
import com.springbootbackend.springbackend.enums.ReservationStatus;


public interface ReservationRespository extends JpaRepository<Reservation, UUID> {
    boolean existsByIdempotencyKey(String idempotencyKey);

    List<Reservation> findByStatusAndExpiresAtBefore(ReservationStatus status, Instant now);

    long countByEventIdAndStatus(String eventId, ReservationStatus status);

    long countByEventIdAndMode(String eventId, ReservationMode mode);
}