package com.springbootbackend.springbackend.services;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.springframework.data.redis.core.Cursor;
import org.springframework.data.redis.core.ScanOptions;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

import com.springbootbackend.springbackend.dto.ReservationEventPayload;
import com.springbootbackend.springbackend.enums.ReservationMode;
import com.springbootbackend.springbackend.enums.ReservationStatus;
import com.springbootbackend.springbackend.models.FlashSaleEvent;
import com.springbootbackend.springbackend.models.Reservation;
import com.springbootbackend.springbackend.repositories.FlashSaleEventRepository;
import com.springbootbackend.springbackend.repositories.ReservationRespository;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

@Service
@RequiredArgsConstructor
@Slf4j
public class LedgerService {
    private final FlashSaleEventRepository eventRepo;
    private final ReservationRespository reservationRepo;
    private final StringRedisTemplate redisTemplate;

    private static final int RESERVATION_TTL = 300; // * 5 mintues TTL to pay for pending reservations

    private void afterCommit(Runnable task) {
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override public void afterCommit() {
                try {
                    task.run();
                } catch (Exception e) {
                    log.warn("[SPRING LEDGER] post-commit task failed", e);
                }
            }
        });
    }

    private Instant parseOrNow(String value, Instant now) {
        try {
            Instant parsed = Instant.parse(value);

            return parsed.isAfter(now) ? now : parsed;
        } catch (Exception e) {
            return now;
        }
    }

    private void deleteByPattern(String pattern) {
        ScanOptions options = ScanOptions.scanOptions().match(pattern).count(500).build();

        List<String> batch = new ArrayList<>();

        try (Cursor<String> cursor = redisTemplate.scan(options)) {
            while (cursor.hasNext()) {
                batch.add(cursor.next());
                if (batch.size() >= 500) { redisTemplate.delete(batch); batch.clear(); }
            }
        }

        if (!batch.isEmpty()) redisTemplate.delete(batch);
    }

    @Transactional
    public void processAtomicReservation(ReservationEventPayload payload) {
        if (reservationRepo.existsByIdempotencyKey(payload.idempotencyKey())) {
            log.info("[SPRING LEDGER] Skipping duplicate idempotency key: {}", payload.idempotencyKey());

            return;
        }

        if (eventRepo.decrementInventoryAtomically(payload.eventId()) == 0) {
            throw new IllegalStateException("[SPRING LEDGER] Event not found or database inventory exhausted for event: " + payload.eventId());
        }
    
        Instant now = Instant.now();
        Instant windowStart = parseOrNow(payload.reservedAt(), now);
    
        reservationRepo.saveAndFlush(Reservation.builder()
            .id(UUID.fromString(payload.reservationId()))
            .eventId(payload.eventId())
            .userId(payload.userId())
            .idempotencyKey(payload.idempotencyKey())
            .status(ReservationStatus.PENDING)
            .mode(ReservationMode.ATOMIC)
            .createdAt(now)
            .expiresAt(windowStart.plusSeconds(RESERVATION_TTL))
            .build());
    
        String telemetryKey = "atomix:event:" + payload.eventId() + ":telemetry";

        afterCommit(() -> redisTemplate.opsForHash().increment(telemetryKey, "postgres_persisted", 1));
    }

    @Transactional
    public Reservation processNaiveReservation(String eventId, String userId, String idempotencyKey) {
        FlashSaleEvent event = eventRepo.findById(eventId).orElseThrow(() -> new IllegalArgumentException("[SPRING LEDGER] Event not found: " + eventId));

        if(event.getAvailableInventory() <= 0) {
            String telemetryKey = "atomix:event:" + eventId + ":telemetry";
            redisTemplate.opsForHash().increment(telemetryKey, "rejected_sold_out", 1);
            throw new IllegalStateException("SOLD_OUT");
        }

        // * simulate 15ms network/validation delay
        try {
            Thread.sleep(15);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }

        // * dcrement DB value without optimistic locking
        eventRepo.decrementInventoryNaive(eventId);

        Instant now = Instant.now();

        Reservation reservation = Reservation.builder()
            .id(UUID.randomUUID())
            .eventId(eventId)
            .userId(userId)
            .idempotencyKey(idempotencyKey)
            .status(ReservationStatus.CONFIRMED)
            .mode(ReservationMode.NAIVE)
            .createdAt(now)
            .expiresAt(now.plusSeconds(RESERVATION_TTL))
            .build();

        Reservation saved = reservationRepo.save(reservation);

        String telemetryKey = "atomix:event:" + eventId + ":telemetry";
        redisTemplate.opsForHash().increment(telemetryKey, "postgres_persisted", 1);
        redisTemplate.opsForValue().decrement("atomix:event:" + eventId + ":stock");

        return saved;
    }

    @Transactional
    public Reservation confirmPayment(UUID reservationId) {
        int updated = reservationRepo.markConfirmedIfPending(reservationId, ReservationStatus.PENDING, ReservationStatus.CONFIRMED, Instant.now());
    
        Reservation reservation = reservationRepo.findById(reservationId).orElseThrow(() -> new IllegalArgumentException("[SPRING LEDGER] Reservation not found: " + reservationId));
    
        if (updated == 1 || reservation.getStatus() == ReservationStatus.CONFIRMED) {
            return reservation;
        }

        throw new IllegalStateException(reservation.getStatus() == ReservationStatus.EXPIRED ? "[SPRING LEDGER] Cannot pay for an expired reservation" : "[SPRING LEDGER] Payment window has elapsed");
    }

    @Transactional
    public FlashSaleEvent resetEventState(String eventId, int initialStock) {
        reservationRepo.deleteByEventId(eventId);

        FlashSaleEvent event = eventRepo.findById(eventId)
            .orElseGet(() -> FlashSaleEvent.builder()
                .id(eventId)
                .productName("Atomix Founders Edition Mechanical Keyboard")
                .build());

        event.setTotalInventory(initialStock);
        event.setAvailableInventory(initialStock);
        FlashSaleEvent savedEvent = eventRepo.save(event);

        String stockKey = "atomix:event:" + eventId + ":stock";
        String buyersKey = "atomix:event:" + eventId + ":buyers";
        String telemetryKey = "atomix:event:" + eventId + ":telemetry";

        redisTemplate.opsForValue().set(stockKey, String.valueOf(initialStock));
        redisTemplate.delete(buyersKey);
        redisTemplate.delete(telemetryKey);
        redisTemplate.opsForHash().putAll(telemetryKey, Map.of(
                "accepted_at_edge", "0",
                "rejected_sold_out", "0",
                "rejected_duplicate", "0",
                "postgres_persisted", "0",
                "reaper_restored", "0"
        ));
        deleteByPattern("atomix:idemp:" + eventId + ":*");
        redisTemplate.delete(List.of("atomix:outbox", "atomix:outbox:processing"));

        log.info("[SPRING LEDGER] Reset Event {} to stock = {} in both PostgreSQL and Redis", eventId, initialStock);
        
        return savedEvent;
    }
}