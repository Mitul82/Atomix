package com.springbootbackend.springbackend.controller;

import java.util.Map;
import java.util.UUID;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.springbootbackend.springbackend.enums.ReservationMode;
import com.springbootbackend.springbackend.enums.ReservationStatus;
import com.springbootbackend.springbackend.models.FlashSaleEvent;
import com.springbootbackend.springbackend.models.Reservation;
import com.springbootbackend.springbackend.repositories.FlashSaleEventRepository;
import com.springbootbackend.springbackend.repositories.ReservationRespository;
import com.springbootbackend.springbackend.responses.ApiResponse;
import com.springbootbackend.springbackend.services.LedgerService;

import jakarta.annotation.PostConstruct;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;


@RestController
@RequiredArgsConstructor
@RequestMapping("${api.prefix}/ledger")
public class LedgerController {
    private final LedgerService ledgerService;
    private final FlashSaleEventRepository eventRepo;
    private final ReservationRespository reservationRepo;

    @PostConstruct
    public void seedInitialEventOnStartup() {
        if(eventRepo.findById("1").isEmpty()) {
            ledgerService.resetEventState("1", 100);
        }
    }

    @PostMapping("/reserve/naive")
    public ResponseEntity<ApiResponse> reserveNaive(
        @RequestHeader(value = "X-User-Id", defaultValue = "anonymous") String userId,
        @RequestHeader(value = "X-Idempotency-key", required = false) String idempotencyKey,
        @RequestBody(required = false) Map<String, Object> body
    ) {
        String eventId = body != null && body.containsKey("eventId") ? String.valueOf(body.get("eventId")) : "1";

        String idemKey = idempotencyKey != null ? idempotencyKey : UUID.randomUUID().toString();

        try {
            Reservation reservation = ledgerService.processNaiveReservation(eventId, userId, idemKey);

            return ResponseEntity.status(HttpStatus.CREATED).body(new ApiResponse("Naive reservation completed", Map.of(
                "status", "CONFIRMED_NAIVE",
                "reservationId", reservation.getId(),
                "userId", userId
            )));
        } catch (IllegalStateException e) {
            if("SOLD_OUT".equals(e.getMessage())) {
                return ResponseEntity.status(HttpStatus.CONFLICT).body(new ApiResponse("Inventory exhausted (Naive check)", "SOLD_OUT"));
            }

            throw e;
        }
    }

    @PostMapping("/orders/{id}/pay")
    public ResponseEntity<ApiResponse> payForOrder(@PathVariable UUID id) {
        try {
            Reservation confirmed = ledgerService.confirmPayment(id);

            return ResponseEntity.ok(new ApiResponse("Reservation confirmed", Map.of(
                "status", confirmed.getStatus(),
                "reservationId", confirmed.getId()
            )));
        } catch (IllegalArgumentException | IllegalStateException e) {
            return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(new ApiResponse(e.getMessage(), null));
        }
    }
    
    @PostMapping("/events/reset")
    public ResponseEntity<ApiResponse> resetEvent(@RequestBody(required = false) Map<String, Object> body) {
        String eventId = body != null && body.containsKey("eventId") ? String.valueOf(body.get("eventId")) : "1";
        
        int stock = body != null && body.containsKey("stock") ? Integer.parseInt(String.valueOf(body.get("stock"))) : 100;

        FlashSaleEvent event = ledgerService.resetEventState(eventId, stock);

        return ResponseEntity.ok(new ApiResponse("PostgreSQL and Redis state synchronized and reset", event));
    }
    
    @GetMapping("/telemetry")
    public ResponseEntity<ApiResponse> getLedgerTelemetry(@RequestParam(defaultValue = "1") String eventId) {
        FlashSaleEvent event = eventRepo.findById(eventId).orElseThrow();

        long pendingCount = reservationRepo.countByEventIdAndStatus(eventId, ReservationStatus.PENDING);
        long confirmedCount = reservationRepo.countByEventIdAndStatus(eventId, ReservationStatus.CONFIRMED);
        long expiredCount = reservationRepo.countByEventIdAndStatus(eventId, ReservationStatus.EXPIRED);
        long totalActiveOrders = pendingCount + confirmedCount;

        long oversoldCount = Math.max(0, totalActiveOrders - event.getTotalInventory());

        return ResponseEntity.ok(new ApiResponse("", Map.ofEntries(
            Map.entry("eventId", eventId),
            Map.entry("productName", event.getProductName()),
            Map.entry("totalInventory", event.getTotalInventory()),
            Map.entry("postgresAvailableInventory", event.getAvailableInventory()),
            Map.entry("pendingReservations", pendingCount),
            Map.entry("confirmedOrders", confirmedCount),
            Map.entry("expiredReapedOrders", expiredCount),
            Map.entry("totalActiveOrders", totalActiveOrders),
            Map.entry("oversoldDiscrepancy", oversoldCount),
            Map.entry("atomicModeCount", reservationRepo.countByEventIdAndMode(eventId, ReservationMode.ATOMIC)),
            Map.entry("naiveModeCount", reservationRepo.countByEventIdAndMode(eventId, ReservationMode.NAIVE))
        )));
    }
}