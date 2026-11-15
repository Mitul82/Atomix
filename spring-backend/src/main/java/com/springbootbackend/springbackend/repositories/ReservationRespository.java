package com.springbootbackend.springbackend.repositories;

import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import com.springbootbackend.springbackend.enums.ReservationMode;
import com.springbootbackend.springbackend.enums.ReservationStatus;
import com.springbootbackend.springbackend.models.Reservation;

public interface ReservationRespository extends JpaRepository<Reservation, UUID> {
    boolean existsByIdempotencyKey(String idempotencyKey);

    List<Reservation> findByStatusAndExpiresAtBefore(ReservationStatus status, Instant now);

    long countByEventIdAndStatus(String eventId, ReservationStatus status);

    long countByEventIdAndMode(String eventId, ReservationMode mode);

    @Query(value = "SELECT * FROM reservations WHERE status = 'PENDING' AND expires_at < NOW() FOR UPDATE SKIP LOCKED LIMIT 100", nativeQuery = true)
    List<Reservation> findAndLockExpiredReservations();

    @Modifying(clearAutomatically = true, flushAutomatically = true)
    @Query("UPDATE Reservation r SET r.status = :confirmed WHERE r.id = :id AND r.status = :pending AND r.expiresAt > :now")
    int markConfirmedIfPending(@Param("id") UUID id, @Param("pending") ReservationStatus pending, @Param("confirmed") ReservationStatus confirmed, @Param("now") Instant now);
    
    @Modifying(clearAutomatically = true)
    @Query("DELETE FROM Reservation r WHERE r.eventId = :eventId")
    int deleteByEventId(@Param("eventId") String eventId);
    
    long countByEventIdAndStatusIn(String eventId, Collection<ReservationStatus> statuses);
}