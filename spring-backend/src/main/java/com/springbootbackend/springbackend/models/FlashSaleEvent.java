package com.springbootbackend.springbackend.models;

import lombok.*;
import jakarta.persistence.*;

// ! the @Version field enables JPA optimistic locking for the atomic flow

@Entity
@Table(name = "flash_sale_events")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class FlashSaleEvent {
    @Id
    @Column(length = 64)
    private String id;

    @Column(nullable = false)
    private String productName;

    @Column(nullable = false)
    private Integer totalInventory;

    @Column(nullable = false)
    private Integer availableInventory;

    @Version
    private Long version;   // * @Version annotation for the optimistic locking version column
}