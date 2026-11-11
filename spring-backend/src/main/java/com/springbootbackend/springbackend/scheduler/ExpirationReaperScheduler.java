package com.springbootbackend.springbackend.scheduler;

import java.time.Instant;
import java.util.List;

import org.springframework.data.redis.core.StringRedisTemplate;
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

    @Scheduled(fixedDelay = 10000) // * runs every 10 seconds
    @Transactional
    public void reapExpiredReservation() {
        List<Reservation> expireList = reservationRepo.findByStatusAndExpiresAtBefore(ReservationStatus.EXPIRED, Instant.now());

        if(expireList.isEmpty()) {
            return;
        }

        log.info("[SPRING LEDGER] Found {} expired PENDING reservations. Reconcilling state...", expireList.size());

        for(Reservation reservation : expireList) {
            reservation.setStatus(ReservationStatus.EXPIRED);
            reservationRepo.save(reservation);

            eventRepo.findById(reservation.getEventId()).ifPresent((event) -> {
                event.setAvailableInventory(event.getAvailableInventory() + 1);
                eventRepo.save(event);
            });

            // ! remove the user from the buyers set in redis so they can try again and also reset the stock count in redis to +1
            String eventId = reservation.getEventId();
            String stockKey = "atomix:event:" + eventId + ":stock";
            String buyersKey = "atomix:event:" + eventId + ":buyers";
            String telemetryKey = "atomix:event:" + eventId + ":telemetry";

            redisTemplate.opsForValue().increment(stockKey, 1);
            redisTemplate.opsForSet().remove(buyersKey, reservation.getUserId());
            redisTemplate.opsForHash().increment(telemetryKey, "reaper_restored", 1);
        }
    }
}