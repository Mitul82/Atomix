<div align="center">

# ⚡ Atomix
### Polyglot High-Concurrency Flash-Sale & Inventory Reservation Engine

[![TypeScript](https://img.shields.io/badge/Edge_Gateway-Node.js_%7C_TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Spring Boot](https://img.shields.io/badge/Core_Ledger-Java_%7C_Spring_Boot-6DB33F?style=for-the-badge&logo=springboot&logoColor=white)](https://spring.io/projects/spring-boot)
[![Redis](https://img.shields.io/badge/Atomic_State-Redis_%7C_Lua_%7C_BullMQ-DC382D?style=for-the-badge&logo=redis&logoColor=white)](https://redis.io/)
[![PostgreSQL](https://img.shields.io/badge/ACID_Storage-PostgreSQL-4169E1?style=for-the-badge&logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Docker](https://img.shields.io/badge/Orchestration-Docker_Compose_%7C_Nginx-2496ED?style=for-the-badge&logo=docker&logoColor=white)](https://www.docker.com/)

*A distributed systems engineering project demonstrating how to survive 10,000+ concurrent requests competing for limited inventory without race conditions, database lock contention, or overselling.*

</div>

---

## 🎯 The Engineering Problem

In standard CRUD applications, purchasing an item follows a simple database sequence:
1. `SELECT available_stock FROM inventory WHERE item_id = $1;`
2. Check if `available_stock > 0` in application memory.
3. `UPDATE inventory SET available_stock = available_stock - 1 WHERE item_id = $1;`

Under normal traffic, this works fine. During a **flash sale** (e.g., 5,000 users clicking "Buy Now" within the same 200ms window for 100 items), this pattern suffers from severe failure modes:
* **Time-of-Check to Time-of-Use (TOCTOU) Race Conditions:** Hundreds of concurrent threads read `available_stock > 0` simultaneously before any `UPDATE` commits, leading to massive overselling.
* **Database Connection Pool Exhaustion:** Opening thousands of synchronous ACID transactions or holding pessimistic row locks (`SELECT ... FOR UPDATE`) saturates PostgreSQL CPU and crashes the service.

**Atomix** solves this by decoupling **high-speed edge reservation** from **durable ledger persistence** using a polyglot architecture.

---

## 🏗️ System Architecture

```text
                        [ 5,000+ Concurrent Client Requests ]
                                          │
                                          ▼
                            ┌───────────────────────────┐
                            │   Nginx Reverse Proxy     │
                            └─────────────┬─────────────┘
                                          │
                                          ▼
┌───────────────────────────────────────────────────────────────────────────────────┐
│ STAGE 1: Edge Ingestion & Gatekeeper (Node.js + TypeScript + Redis)               │
│                                                                                   │
│  1. Token-Bucket Rate Limiter & Idempotency Key Verification                      │
│  2. Executes Atomic Redis Lua Script (Single-Threaded, Sub-Millisecond):          │
│     • Checks if `stock > 0`                                                       │
│     • Checks if `userId` is already in `event:buyers` Set (prevents double-buys)  │
│     • Decrements `stock` & adds `userId` to Set atomically                        │
└─────────┬───────────────────────────────────────────────────────────────┬─────────┘
          │                                                               │
          │ (Stock == 0 or Duplicate User)                                │ (Stock Reserved!)
          ▼                                                               ▼
┌───────────────────────────┐                           ┌───────────────────────────────────┐
│ HTTP 429 / 409 Fast-Fail  │                           │ HTTP 202 Accepted (Reservation ID)│
│ (Zero Database Load)      │                           └─────────────────┬─────────────────┘
└───────────────────────────┘                                             │
                                                                          ▼
                                                        ┌───────────────────────────────────┐
                                                        │ STAGE 2: Asynchronous Event Queue │
                                                        │ (BullMQ / Redis Streams)          │
                                                        │  • Buffers burst traffic          │
                                                        │  • Emits `InventoryReserved` job  │
                                                        └─────────────────┬─────────────────┘
                                                                          │
                                                                          ▼
┌───────────────────────────────────────────────────────────────────────────────────┐
│ STAGE 3: Core Transaction Ledger (Java + Spring Boot + PostgreSQL)                │
│                                                                                   │
│  • Consumes queue at controlled concurrency (protects PostgreSQL connection pool) │
│  • Writes `PENDING` reservation with Optimistic Locking (@Version) & 5-min TTL    │
│  • Pushes real-time status updates to client via Server-Sent Events (SSE)         │
└─────────────────────────┬───────────────────────────────────────────────┬─────────┘
                          │                                               │
        (Payment Confirmed within 5m)                       (TTL Expired / Payment Failed)
                          ▼                                               ▼
        ┌───────────────────────────────────┐           ┌───────────────────────────────────┐
        │ STAGE 4A: Ledger Finalization     │           │ STAGE 4B: Distributed Reaper Cron │
        │  • Status -> `CONFIRMED`          │           │  • Spring @Scheduled scans expired│
        │  • Emits final receipt via SSE    │           │  • Status -> `EXPIRED` in Postgres│
        └───────────────────────────────────┘           │  • Restores +1 stock in Redis Lua │
                                                        └───────────────────────────────────┘
```

---

## 🧠 Core Engineering Highlights

### 1. Sub-Millisecond Atomic Reservations via Redis Lua Scripting
Instead of relying on slow application-level locks, Atomix embeds its reservation logic directly inside Redis using a custom Lua script (`reserve_inventory.lua`). Because Redis executes Lua scripts atomically on its single event loop, checking stock availability, verifying one-per-user purchase limits, and decrementing stock occur as a single indivisible operation with zero race conditions.

### 2. Polyglot Microservice Separation
* **Node.js (TypeScript) at the Edge:** Optimized for non-blocking I/O, handling thousands of concurrent HTTP/SSE connections, Redis Lua execution, and queue ingestion.
* **Spring Boot (Java) at the Core:** Optimized for strict type safety, multi-threaded background job processing, Spring Data JPA transactional boundaries (`@Transactional`), and scheduled state reconciliation.

### 3. Asynchronous Backpressure & Queue Buffering
When 100 users win the flash sale within 50 milliseconds, PostgreSQL never sees a 100-connection spike. The Node.js edge immediately returns `202 Accepted` with a tracking token and pushes jobs into **BullMQ**. The Spring Boot ledger pulls and persists these orders at a steady, predictable throughput.

### 4. Self-Healing State Reconciliation (The "Ghost Stock" Reaper)
In distributed systems, users often reserve an item and abandon checkout. Atomix runs a Spring Boot `@Scheduled` reconciliation worker that identifies `PENDING` orders past their `expires_at` timestamp, transitions them to `EXPIRED` in PostgreSQL using optimistic locking, and executes a compensating Redis transaction to release the locked inventory back into the live pool.

### 5. End-to-End Idempotency
Network retries during high traffic can cause duplicate charges. Every checkout request requires an `X-Idempotency-Key` header, enforced both at the Redis edge cache and via a `UNIQUE` constraint on the PostgreSQL `reservations` table.

---

## 🔥 The "War Room": Naive vs. Atomic Mode

To make the distributed systems concepts visually verifiable, Atomix ships with an interactive **Split-Screen War Room Dashboard** built with React, Tailwind CSS, and Server-Sent Events (SSE).

| Metric (1,000 Concurrent Buyers / 100 Stock) | ❌ Naive Mode (`/api/v1/purchase/naive`) | ⚡ Atomic Mode (`/api/v1/purchase/atomic`) |
|---|---|---|
| **Concurrency Control** | Standard SQL `SELECT` then `UPDATE` | Redis Lua Gatekeeper + Queue + Optimistic Locking |
| **Total Stock Available** | 100 | 100 |
| **Total Orders Confirmed** | ~118 – 145 *(Severe Overselling)* | **100** *(Exact Match)* |
| **Oversold Discrepancy** | +18 to +45 items | **0 items** |
| **Edge p95 Latency (Local Docker)** | ~420ms – 1,200ms (DB Lock Contention) | **~4ms – 12ms** |
| **PostgreSQL Connection Spike** | Saturated / Pool Timeout Errors | Smooth, throttled queue consumption |

*(Note: Latency metrics represent typical targets in a local multi-container Docker Compose environment and vary based on host hardware.)*

---

## 🛠️ Tech Stack

* **Edge Service:** Node.js, TypeScript, Express, `ioredis`, BullMQ, Zod
* **Core Ledger Service:** Java 21, Spring Boot 3, Spring Data JPA, Spring Validation, PostgreSQL Driver
* **Data & Messaging:** Redis 7 (Lua Scripting, Pub/Sub, Streams), PostgreSQL 16
* **Frontend War Room:** React, TypeScript, Vite, Tailwind CSS, TanStack Query, Lucide Icons
* **Infrastructure & Testing:** Docker, Docker Compose, Nginx, Grafana k6 (Load Testing)

---

## 📂 Repository Structure

```text
Atomix/
├── docker-compose.yml               # Orchestrates Nginx, Edge, Ledger, Redis, Postgres & UI
├── nginx/
│   └── nginx.conf                   # Reverse proxy & SSE stream routing configuration
├── node-backend/                    # Node.js + TypeScript High-Concurrency Gatekeeper
│   │   ├── redis/
│   │   │   └── reserveInventory.lua # Atomic stock decrement & duplicate buyer check
│   │   ├── queues/                  # BullMQ producer definitions
│   │   ├── routes/                  # Atomic, Naive & SSE telemetry endpoints
│   │   └── app.ts
│   └── Dockerfile
├── spring-backend/                  # Java + Spring Boot Core Transaction Engine
│   ├── src/main/java/com/Atomix/ledger/
│   │   ├── consumer/                # Queue workers consuming reservation events
│   │   ├── entity/                  # JPA Entities (FlashSaleEvent, Reservation)
│   │   ├── scheduler/               # Expiration Reaper cron (@Scheduled)
│   │   └── service/                 # ACID transactional order processing
│   └── Dockerfile
├── frontend/                     # React + Tailwind Split-Screen Visualizer
    ├── src/
    │   ├── components/              # Storefront Panel + Chaos Telemetry Console
    │   └── hooks/                   # Real-time SSE stream hooks
    └── Dockerfile
```
<!-- └── benchmarks/ -->
<!-- └── k6-spike-test.js             # Automated 5,000-VU spike test script -->

---

## 🚀 Getting Started

### Prerequisites
* [Docker](https://www.docker.com/) & Docker Compose installed on your machine.
* *(Optional)* [Grafana k6](https://k6.io/) for running CLI load benchmarks.

### 1. Clone & Launch the Cluster
```bash
git clone [https://github.com/Mitul82/Atomix.git](https://github.com/Mitul82/Atomix.git)
cd Atomix

# Spin up Postgres, Redis, Node.js Edge, Spring Boot Ledger, Nginx, and React UI
docker compose up --build -d
```

### 2. Access the Services
* **War Room UI & Storefront:** `http://localhost:80` (or `http://localhost:5173` in dev)
* **Edge Service API (Node.js):** `http://localhost:3000/api/v1/edge`
* **Core Ledger API (Spring Boot):** `http://localhost:3000/api/v1/ledger`

### 3. Run the Stress Test
You can trigger a 1,000-request burst directly from the **War Room UI** using the *"Simulate Traffic Spike"* button, or run the included `k6` benchmark from your terminal:

```bash
docker run --rm -i \
    --network="atomix_network" \
    --cpu-quota=200000 \
    --memory="1g" \
    grafana/k6 run - < benchmarks/k6-spike-test.js
```

---

## 🔌 API Endpoints

| Method | Endpoint | Service | Description |
|---|---|---|---|
| `POST` | `/api/v1/edge/reserve/atomic` | Node.js Edge | Reserves 1 unit via Redis Lua script & queues ledger persistence (`202 Accepted`). |
| `POST` | `/api/v1/edge/reserve/naive` | Node.js / Spring | Bypasses Redis Lua lock to demonstrate race conditions & overselling under load. |
| `GET` | `/api/v1/edge/telemetry/stream` | Node.js Edge | Server-Sent Events (SSE) stream broadcasting real-time Redis vs. Postgres state. |
| `POST` | `/api/v1/ledger/orders/:id/pay` | Spring Boot | Confirms payment for a `PENDING` reservation before its TTL expires (`200 OK`). |
| `POST` | `/api/v1/ledger/events/reset` | Spring Boot | Resets PostgreSQL & Redis stock counters to `100` for a fresh benchmark run. |

---

## 👤 Author

**Mitul Srivastava**
* GitHub: [@Mitul82](https://github.com/Mitul82)