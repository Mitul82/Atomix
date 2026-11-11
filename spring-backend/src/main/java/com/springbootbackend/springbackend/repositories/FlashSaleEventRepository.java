package com.springbootbackend.springbackend.repositories;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import com.springbootbackend.springbackend.models.FlashSaleEvent;

public interface FlashSaleEventRepository extends JpaRepository<FlashSaleEvent, String> {
    /*
        * Used ONLY in Naive Mode: updates inventory directly in SQL without checking @Version,
        * allowing classic Time-of-Check to Time-of-Use race conditions to occur. 
    */
   @Modifying
   @Query("UPDATE FlashSaleEvent e SET e.availableInventory = e.availableInventory - 1 WHERE e.id = :id")
   void decrementInventoryNaive(@Param("id") String id);
}