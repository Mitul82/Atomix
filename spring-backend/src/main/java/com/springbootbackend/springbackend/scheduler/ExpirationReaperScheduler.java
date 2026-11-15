package com.springbootbackend.springbackend.scheduler;

import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import com.springbootbackend.springbackend.enums.ReservationMode;
import com.springbootbackend.springbackend.enums.ReservationStatus;
import com.springbootbackend.springbackend.models.FlashSaleEvent;
import com.springbootbackend.springbackend.models.Reservation;
import com.springbootbackend.springbackend.repositories.FlashSaleEventRepository;
import com.springbootbackend.springbackend.repositories.ReservationRespository;

import jakarta.transaction.Transactional;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

@Component
@RequiredArgsConstructor
@Slf4j
public class ExpirationReaperScheduler {
    private final ReservationRespository reservationRepo;
    private final FlashSaleEventRepository eventRepo;
    private final StringRedisTemplate redisTemplate;

    private final Map<String, Long> lastDrift = new ConcurrentHashMap<>();

    private static final DefaultRedisScript<Long> reaperRestoreScript = new DefaultRedisScript<>(
        "if redis.call('SISMEMBER', KEYS[2], ARGV[1]) == 1 then " +
        "  redis.call('INCR', KEYS[1]); " +
        "  redis.call('SREM', KEYS[2], ARGV[1]); " +
        "  redis.call('HINCRBY', KEYS[3], 'reaper_restored', 1); " +
        "  return 1; " +
        "end; " +
        "return 0;",
        Long.class
    );

    @Scheduled(fixedDelay = 10000) // * runs every 10 seconds
    @Transactional
    public void reapExpiredReservation() {
        List<Reservation> expireList = reservationRepo.findAndLockExpiredReservations();
        if (expireList.isEmpty()) return;

        log.info("[SPRING LEDGER] Found {} expired PENDING reservations. Reconciling state...", expireList.size());

        for (Reservation reservation : expireList) {
            reservation.setStatus(ReservationStatus.EXPIRED);

            eventRepo.incrementAvailableInventory(reservation.getEventId());
        }

        reservationRepo.saveAll(expireList);

        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override public void afterCommit() {
                restoreRedis(expireList);
            }
        });
    }

    private void restoreRedis(List<Reservation> expireList) {
        for (Reservation reservation : expireList) {
            String eventId = reservation.getEventId();
            try {
                redisTemplate.execute(reaperRestoreScript, List.of(
                    "atomix:event:" + eventId + ":stock",
                    "atomix:event:" + eventId + ":buyers",
                    "atomix:event:" + eventId + ":telemetry"), reservation.getUserId());
            } catch (Exception e) {
                log.error("[REAPER] Redis restore failed for reservation {} (event {}); drift check will flag it", reservation.getId(), eventId, e);
            }
        }
    }

    // * detects a crash between DB commit and Redis restore; warns only when the same drift persists across two checks
    @Scheduled(fixedDelay = 60_000)
    public void checkDrift() {
        for (FlashSaleEvent event : eventRepo.findAll()) {
            if (reservationRepo.countByEventIdAndMode(event.getId(), ReservationMode.NAIVE) > 0){
                continue;
            }

            long active = reservationRepo.countByEventIdAndStatusIn(event.getId(), List.of(ReservationStatus.PENDING, ReservationStatus.CONFIRMED));

            String raw = redisTemplate.opsForValue().get("atomix:event:" + event.getId() + ":stock");

            long drift = event.getTotalInventory() - active - (raw == null ? 0 : Long.parseLong(raw));

            Long previous = lastDrift.put(event.getId(), drift);
            
            if (drift != 0 && Long.valueOf(drift).equals(previous)) {
                log.warn("[RECONCILE] event={} sustained drift={} (inventory leaked between Redis and Postgres)", event.getId(), drift);
            }
        }
    }
}