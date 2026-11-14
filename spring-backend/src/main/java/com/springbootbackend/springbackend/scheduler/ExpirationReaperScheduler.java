package com.springbootbackend.springbackend.scheduler;

import java.util.List;

import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import com.springbootbackend.springbackend.enums.ReservationStatus;
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

        if(expireList.isEmpty()) {
            return;
        }

        log.info("[SPRING LEDGER] Found {} expired PENDING reservations. Reconcilling state...", expireList.size());

        for (Reservation reservation : expireList) {
            reservation.setStatus(ReservationStatus.EXPIRED);
            reservationRepo.save(reservation);

            eventRepo.findById(reservation.getEventId()).ifPresent((event) -> {
                event.setAvailableInventory(event.getAvailableInventory() + 1);
                eventRepo.save(event);
            });

            String eventId = reservation.getEventId();
            List<String> keys = List.of(
                    "atomix:event:" + eventId + ":stock",
                    "atomix:event:" + eventId + ":buyers",
                    "atomix:event:" + eventId + ":telemetry"
            );

            redisTemplate.execute(reaperRestoreScript, keys, reservation.getUserId());
        }
    }
}