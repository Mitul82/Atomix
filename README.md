<div align="center">

# ⚡ Atomix
### Polyglot High-Concurrency Flash-Sale & Inventory Reservation Engine

[![TypeScript](https://img.shields.io/badge/Edge_Gateway-Node.js_24_%7C_PM2_%7C_TS-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Spring Boot](https://img.shields.io/badge/Core_Ledger-Java_25_%7C_Spring_Boot_4-6DB33F?style=for-the-badge&logo=springboot&logoColor=white)](https://spring.io/projects/spring-boot)
[![Redis](https://img.shields.io/badge/Atomic_State-Redis_7_%7C_Lua_EVALSHA-DC382D?style=for-the-badge&logo=redis&logoColor=white)](https://redis.io/)
[![RabbitMQ](https://img.shields.io/badge/Event_Broker-RabbitMQ_4_(AMQP)-FF6600?style=for-the-badge&logo=rabbitmq&logoColor=white)](https://www.rabbitmq.com/)
[![PostgreSQL](https://img.shields.io/badge/ACID_Storage-PostgreSQL_18-4169E1?style=for-the-badge&logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Docker](https://img.shields.io/badge/Orchestration-Docker_Compose_%7C_Nginx-2496ED?style=for-the-badge&logo=docker&logoColor=white)](https://www.docker.com/)

*A distributed systems engineering project demonstrating how to handle 396,000+ flash-sale requests (~10,565 req/s sustained throughput) competing for limited inventory with a 7.07ms median latency, minimal database lock contention, and zero overselling.*

</div>

---

## 🎯 The Engineering Problem

In standard CRUD applications, purchasing an item follows a simple database sequence:
1. `SELECT available_stock FROM inventory WHERE item_id = $1;`
2. Check if `available_stock > 0` in application memory.
3. `UPDATE inventory SET available_stock = available_stock - 1 WHERE item_id = $1;`

Under normal traffic, this works fine. During a **flash sale** (e.g., thousands of users clicking "Buy Now" within the same window for 100 items), this pattern suffers from severe failure modes:
* **Time-of-Check to Time-of-Use (TOCTOU) Race Conditions:** Hundreds of concurrent threads read `available_stock > 0` simultaneously before any `UPDATE` commits, leading to massive overselling.
* **Database Connection Pool Exhaustion:** Opening thousands of synchronous ACID transactions or holding pessimistic row locks (`SELECT ... FOR UPDATE`) saturates PostgreSQL CPU and exhausts HikariCP connection pools.

**Atomix** solves this by decoupling **high-speed edge reservation** from **durable ledger persistence** using a multi-tiered L1/L2 caching strategy, atomic Redis Lua scripting, and asynchronous AMQP backpressure.

---

## 🏗️ System Architecture

```text
                    [ 396,677 Flash-Sale Requests / 500 Concurrent VUs ]
                                              │
                                              ▼
                     ┌─────────────────────────────────────────────────┐
                     │ Nginx API Gateway (:80)                         │
                     │ • epoll / 16,384 worker_connections             │
                     │ • 1,024 persistent upstream keepalive sockets   │
                     └────────────────────────┬────────────────────────┘
                                              │
                                              ▼
┌───────────────────────────────────────────────────────────────────────────────────┐
│ STAGE 1: Clustered Edge Gatekeeper (Node.js 24 + Express 5 + PM2 `-i max`)        │
│                                                                                   │
│  1. L1 In-Memory Circuit Breaker (Per-Worker V8 RAM Cache, 250ms TTL):            │
│     • Absorbs post-sellout traffic floods in ~216µs with zero Redis network I/O   │
│  2. L2 Atomic Redis Lua Script (`EVALSHA`, Single-Threaded Execution):            │
│     • Checks `X-Idempotency-Key` -> Checks `stock > 0` -> Checks `buyers` Set     │
│     • Decrements `stock` & records buyer atomically in sub-millisecond time       │
└─────────┬───────────────────────────────────────────────────────────────┬─────────┘
          │                                                               │
          │ (Stock == 0 or Duplicate Buyer)                               │ (Stock Reserved!)
          ▼                                                               ▼
┌───────────────────────────┐                           ┌───────────────────────────────────┐
│ HTTP 409 / 429 Fast-Fail  │                           │ HTTP 202 Accepted (Reservation ID)│
│ (Zero PostgreSQL Load)    │                           └─────────────────┬─────────────────┘
└───────────────────────────┘                                             │
                                                                          ▼
                                                        ┌───────────────────────────────────┐
                                                        │ STAGE 2: Asynchronous AMQP Broker │
                                                        │ (RabbitMQ 4 — Durable Exchange)   │
                                                        │  • Buffers burst traffic          │
                                                        │  • Publishes persistent JSON msg  │
                                                        │  • Enforces consumer backpressure │
                                                        └─────────────────┬─────────────────┘
                                                                          │ (prefetch = 25)
                                                                          ▼
┌───────────────────────────────────────────────────────────────────────────────────┐
│ STAGE 3: Core Transaction Ledger (Java 25 + Spring Boot 4 + PostgreSQL 18)        │
│                                                                                   │
│  • @RabbitListener drains queue at controlled concurrency (protects HikariCP)     │
│  • Writes `PENDING` reservation with Optimistic Locking (@Version) & 5-min TTL    │
│  • Updates Redis telemetry hash -> streamed to React UI via Node.js SSE (250ms)   │
└─────────────────────────┬───────────────────────────────────────────────┬─────────┘
                          │                                               │
        (Payment Confirmed within 5m)                       (TTL Expired / Unpaid Order)
                          ▼                                               ▼
        ┌───────────────────────────────────┐           ┌───────────────────────────────────┐
        │ STAGE 4A: Ledger Finalization     │           │ STAGE 4B: Distributed Reaper Cron │
        │  • Status -> `CONFIRMED`          │           │  • Spring @Scheduled (every 10s)  │
        │  • Finalized in PostgreSQL ACID   │           │  • Status -> `EXPIRED` in Postgres│
        └───────────────────────────────────┘           │  • Restores +1 stock in Redis     │
                                                        │  • Removes user from buyers Set   │
                                                        └───────────────────────────────────┘
```

---

## 🧠 Core Engineering Highlights

### 1. Two-Tier Edge Gatekeeping (L1 V8 RAM Circuit Breaker + L2 Redis Lua `EVALSHA`)
* **L2 Atomic State (Redis Lua):** Atomix pre-compiles `reserveInventory.lua` into Redis RAM on boot via `SCRIPT LOAD` and executes it via `EVALSHA`. Because Redis runs Lua scripts atomically on its single event loop, verifying idempotency keys, checking stock availability first (fast-fail ordering), verifying one-per-user purchase limits (`SISMEMBER`), and decrementing inventory happen as one indivisible operation.
* **L1 Process-Local Circuit Breaker:** Once Redis reports `SOLD_OUT` (`-1`), each PM2 worker trips a short-lived (250ms TTL) in-memory circuit breaker (`Map<eventId, expiresAt>`). Subsequent requests during a traffic spike are rejected straight from V8 RAM in **~216µs** without touching the Redis network socket, while the 250ms TTL ensures stock restored by the Expiration Reaper quickly re-opens the gate.

### 2. Multi-Core PM2 Clustering & High-Throughput Nginx Tuning
* **PM2 Cluster Mode (`-i max`):** The stateless Node.js gatekeeper forks across available CPU cores inside the container, multiplying parallel TCP socket capacity toward Redis and RabbitMQ.
* **Nginx Socket Optimization:** Configured with `worker_rlimit_nofile 65535`, `worker_connections 16384`, `epoll`, and a persistent `keepalive 1024` upstream connection pool to prevent TCP 3-way handshake churn and ephemeral port starvation during 500-VU spikes.

### 3. Polyglot Microservices & Strict Database Isolation
* **Node.js Edge Service (`node-backend`):** Has **zero connection to PostgreSQL**. It communicates strictly with **Redis** and **RabbitMQ**, ensuring massive traffic spikes do not leak through to the relational database.
* **Spring Boot Ledger Service (`spring-backend`):** Acts as the sole owner of **PostgreSQL 18**, managing ACID transactions (`@Transactional`) with JPA Optimistic Locking (`@Version`).

### 4. Asynchronous Backpressure with RabbitMQ (`prefetch = 25`)
When 100 buyers win the flash sale within milliseconds, the Node.js edge immediately returns `202 Accepted` and publishes persistent messages to `atomix.exchange`. Spring Boot's `@RabbitListener` is configured with `prefetch: 25`, pulling messages at a steady pace so PostgreSQL's HikariCP connection pool remains stable.

### 5. Self-Healing State Reconciliation (The "Ghost Stock" Reaper)
A Spring Boot `@Scheduled` worker (`ExpirationReaperScheduler`) runs every 10 seconds to scan for unpaid `PENDING` orders past their 5-minute TTL, transitions them to `EXPIRED` in PostgreSQL, restores `+1` inventory to the database, and executes compensating Redis commands (`INCR` stock and `SREM` buyer) so another user can purchase the item.

---

## 📊 Load Testing & Benchmark Results (Grafana k6)

The production Docker cluster was benchmarked using **Grafana k6** over a 35-second multi-stage `ramping-vus` workload (warming up to 50 sustained VUs, spiking to **500 concurrent VUs**, and ramping down) competing for **100 units of inventory**.

### Verified Atomic Mode Benchmark (`396,677` Requests at `10,565 req/s`)

<div align="center">
  <img src="./docs/k6-benchmark-result.png" alt="Grafana k6 Benchmark Results - 396,677 Requests at 10,565 req/s" width="850" />
  <p><em>Grafana k6 sustained + 500-VU spike test executing 396,677 requests at 10,565.20 req/s with 0.00% errors, 7.07ms median latency, and 0 oversold inventory.</em></p>
</div>

| Benchmark Metric (35s Sustained + 500-VU Spike) | ⚡ Atomix Edge Pipeline (Verified k6 Run) |
|---|---|
| **Total HTTP Requests Processed** | **396,677 requests** |
| **Sustained Throughput** | **10,565.20 req/sec** |
| **Network Data Transferred** | **485 MB received (13 MB/s) / 98 MB sent (2.6 MB/s)** |
| **Initial Inventory Stock** | **100 units** |
| **Orders Accepted (`202 Accepted`)** | **100 units** *(Exact Match)* |
| **Orders Rejected Cleanly (`409 Sold Out`)** | **396,575 requests** |
| **Oversold Discrepancy (PostgreSQL Audit)** | **0 units** |
| **Unexpected / HTTP Failure Rate (`5xx`)** | **0.00% (0 / 396,677)** |
| **Minimum Latency (L1 Circuit Breaker)** | **216.18 µs (0.21 ms)** |
| **Median Latency (`p50`)** | **7.07 ms** |
| **Average Latency** | **18.54 ms** |
| **p90 Latency** | **46.22 ms** |
| **p95 Latency** | **57.62 ms** |
| **Maximum Latency (`p100`)** | **156.11 ms** |

### Naive SQL vs. Atomic Edge Comparison

*Metrics below reflect behavior in a local multi-container Docker Compose environment and vary by host hardware.*

| Metric | ❌ Naive Mode (`/api/v1/ledger/reserve/naive`) | ⚡ Atomic Mode (`/api/v1/reserve/atomic`) |
|---|---|---|
| **Concurrency Control** | Standard SQL `SELECT` then `UPDATE` | L1 RAM Cache + L2 Redis Lua + RabbitMQ + JPA `@Version` |
| **Oversold Discrepancy (100 Stock)** | ~18 to 45+ units *(Severe Race Condition)* | **0 units (100 / 100 Exact)** |
| **Edge p95 Latency (500 VUs)** | ~420ms – 1,200ms+ (DB Lock Contention) | **57.62 ms (7.07 ms Median)** |
| **Peak Sustained Throughput** | ~150 – 300 req/s (Bottlenecked by DB Locks) | **10,565.20 req/s** |
| **PostgreSQL Connection Pool Impact** | Saturated / HikariCP Timeout Errors | **Isolated & Throttled (`prefetch = 25`)** |

---

## 🛠️ Tech Stack

* **Edge Gatekeeper (`node-backend`):** Node.js 24, PM2 Cluster Runtime, TypeScript 7, Express 5, `redis` (v6), `amqplib`, `express-rate-limit`, `rate-limit-redis`, Helmet, Zod
* **Core Transaction Ledger (`spring-backend`):** Java 25, Spring Boot 4.1, Spring Data JPA (Hibernate), Spring AMQP (RabbitMQ), Spring Data Redis, Jakarta Validation, Lombok
* **Data & Messaging Infrastructure:** Redis 7 Alpine (`noeviction`), RabbitMQ 4 Management, PostgreSQL 18 Alpine, pgAdmin 4
* **War Room UI (`frontend`):** React, TypeScript, Vite, Tailwind CSS, Axios, Native `EventSource` (SSE), Lucide Icons
* **Gateway, Orchestration & Benchmarking:** Nginx Reverse Proxy (`epoll` tuned), Docker & Docker Compose (split Dev/Prod topologies), Grafana k6

---

## 📂 Repository Structure

```text
└── Atomix/
    ├── .env.dev.example
    ├── .env.prod.example
    ├── .gitignore
    ├── docker-compose.dev.yaml
    ├── docker-compose.prod.yaml
    ├── LICENSE
    ├── package.json
    ├── README.md
    ├── spring-backend/
    │   ├── .dockerignore
    │   ├── .env.example
    │   ├── .gitattributes
    │   ├── Dockerfile
    │   ├── HELP.md
    │   ├── mvnw
    │   ├── mvnw.cmd
    │   ├── pom.xml
    │   ├── .mvn/
    │   │   └── wrapper/
    │   │       └── maven-wrapper.properties
    │   └── src/
    │       ├── main/
    │       │   ├── resources/
    │       │   │   ├── application.yaml
    │       │   │   └── banner.txt
    │       │   └── java/
    │       │       └── com/
    │       │           └── springbootbackend/
    │       │               └── springbackend/
    │       │                   ├── SpringbackendApplication.java
    │       │                   ├── services/
    │       │                   │   └── LedgerService.java
    │       │                   ├── scheduler/
    │       │                   │   └── ExpirationReaperScheduler.java
    │       │                   ├── responses/
    │       │                   │   └── ApiResponse.java
    │       │                   ├── repositories/
    │       │                   │   ├── FlashSaleEventRepository.java
    │       │                   │   └── ReservationRespository.java
    │       │                   ├── models/
    │       │                   │   ├── FlashSaleEvent.java
    │       │                   │   └── Reservation.java
    │       │                   ├── enums/
    │       │                   │   ├── ReservationMode.java
    │       │                   │   └── ReservationStatus.java
    │       │                   ├── dto/
    │       │                   │   └── ReservationEventPayload.java
    │       │                   ├── controller/
    │       │                   │   └── LedgerController.java
    │       │                   ├── consumer/
    │       │                   │   └── ReservationConsumer.java
    │       │                   └── config/
    │       │                       └── RabbitMqConfig.java
    │       └── test/
    │           └── java/
    │               └── com/
    │                   └── springbootbackend/
    │                       └── springbackend/
    │                           └── SpringbackendApplicationTests.java
    ├── node-backend/
    │   ├── .dockerignore
    │   ├── .env.example
    │   ├── app.ts
    │   ├── Dockerfile
    │   ├── nodemon.json
    │   ├── package-lock.json
    │   ├── package.json
    │   ├── tsconfig.json
    │   ├── validation/
    │   │   └── schemaValidation.ts
    │   ├── types/
    │   │   ├── index.ts
    │   │   ├── IReservationPayload.ts
    │   │   └── ReservationResult.ts
    │   ├── scripts/
    │   │   └── copy-assets.js
    │   ├── routes/
    │   │   └── edgeRoutes.ts
    │   ├── queues/
    │   │   └── reservationQueue.ts
    │   ├── database/
    │   │   ├── connectRabbitmq.ts
    │   │   └── connectRedis.ts
    │   ├── controllers/
    │   │   └── edgeControllers.ts
    │   └── utils/
    │       └── redis/
    │           ├── luaLoader.ts
    │           └── reserveInventory.lua
    ├── frontend/
    │   ├── .dockerignore
    │   ├── .env.example
    │   ├── Dockerfile
    │   ├── eslint.config.js
    │   ├── index.html
    │   ├── nginx.conf
    │   ├── package-lock.json
    │   ├── package.json
    │   ├── tsconfig.app.json
    │   ├── tsconfig.json
    │   ├── tsconfig.node.json
    │   ├── vite.config.ts
    │   ├── src/
    │   │   ├── App.tsx
    │   │   ├── index.css
    │   │   ├── main.tsx
    │   │   ├── utils/
    │   │   │   └── api.ts
    │   │   ├── types/
    │   │   │   ├── ActiveCustomer.ts
    │   │   │   ├── CustomerStoreFrontProps.ts
    │   │   │   ├── EdgeTelemetry.ts
    │   │   │   ├── index.ts
    │   │   │   ├── LedgerTruth.ts
    │   │   │   ├── LoadGeneratorProps.ts
    │   │   │   └── NavbarProps.ts
    │   │   ├── hooks/
    │   │   │   └── useTelemetry.tsx
    │   │   └── components/
    │   │       ├── CustomerStoreFront.tsx
    │   │       ├── LoadGenerator.tsx
    │   │       ├── Navbar.tsx
    │   │       └── OverSellBanner.tsx
    │   └── public/
    │       └── favicon/
    │           ├── android-chrome-192x192.png
    │           ├── android-chrome-512x512.png
    │           ├── apple-touch-icon.png
    │           ├── favicon-16x16.png
    │           ├── favicon-32x32.png
    │           ├── favicon.ico
    │           └── site.webmanifest
    ├── nginx/
    │   ├── default.conf
    │   └── nginx.conf
    ├── docs/
    │   └── k6-benchmark-result.png
    └── benchmarks/
        └── k6-spike-test.js
```

---

## 🚀 Getting Started

### Prerequisites
* [Docker](https://www.docker.com/) & Docker Compose installed on your machine.
* *(For Local Dev Mode)* Node.js 22+, Java 25 JDK, and Maven.

### Option A: Launch the Full Production Cluster
Spins up all 8 services (`nginx`, `frontend`, `node-service`, `spring-ledger`, `postgres`, `redis`, `rabbitmq`, and `pgadmin`) inside `atomix-network`.

```bash
git clone https://github.com/Mitul82/Atomix.git

cd Atomix
```
```bash
# Create the `.env.prod` file
cp ./.env.prod.example ./.env.prod

# Build and start the production stack using the root convenience script
npm run prod-up

# Stream real-time logs across the cluster
npm run prod-logs
```

**Production Access URLs:**
* **War Room UI & Storefront (via Nginx Gateway):** `http://localhost` (Port 80)
* **RabbitMQ Management Console:** `http://127.0.0.1:15672`
* **pgAdmin 4 Dashboard:** `http://127.0.0.1:8081` (or `:5050` depending on your `.env.prod`)

---

### Option B: Run in Development Mode (Local IDE Hot-Reloading)
Starts only the backing infrastructure (`postgres`, `redis`, `rabbitmq`, `pgadmin`) in Docker so you can run Node.js, Spring Boot, and Vite natively on your host machine.

```bash
# Create the `.env.dev` file
cp ./.env.dev.example ./.env.dev

# 1. Start backing databases and message broker
npm run dev-up

# 2. CD into the node backend folder and install the dependencies
cd node-backend && npm install

# 3. Create the .env file for the node service
cp ./.env.example ./.env

# 4. Start the node service
npm run dev

# 5. CD into the spring backend folder
cd ../spring-backend

# 6. Create the .env file for the spring service
cp ./.env.example ./.env

# 7. Start the spring service
./mvnw spring-boot:run

# 8. CD into the frontend and install the dependencies
cd ../frontend && npm install

# 9. Create the .env file for the frontend
cp ./.env.example ./.env

# 10. Start the frontend service
npm run dev
```

---

### Run the Grafana k6 Stress Test

**Linux / macOS / WSL2 / Git Bash:**
```bash
docker run --rm -i \
  --network="atomix-network" \
  --cpu-quota=200000 \
  --memory="1g" \
  -e MODE=ATOMIC \
  -e BASE_URL=http://nginx \
  grafana/k6 run - < benchmarks/k6-spike-test.js
```

**Windows PowerShell:**
```powershell
Get-Content benchmarks/k6-spike-test.js | docker run --rm -i `
  --network="atomix-network" `
  --cpu-quota=200000 `
  --memory="1g" `
  -e MODE=ATOMIC `
  -e BASE_URL=http://nginx `
  grafana/k6 run -
```

---

## 🔌 API Reference

All endpoints are routed through the global **Nginx Reverse Proxy** on port `80`:

| Method | Endpoint | Upstream Service | Description |
|---|---|---|---|
| `POST` | `/api/v1/reserve/atomic` | `node-service` | Checks L1 cache, executes L2 Redis Lua script & publishes to RabbitMQ (`202 Accepted`). |
| `GET` | `/api/v1/telemetry/stream` | `node-service` | Server-Sent Events (SSE) stream pushing live Redis & pipeline counters every 250ms. |
| `POST` | `/api/v1/simulate-spike` | `node-service` | Launches concurrent virtual buyer requests from the backend for browser War Room demos. |
| `POST` | `/api/v1/seed` | `node-service` | Initializes or resets Redis stock, L1 cache, and telemetry hashes for an event. |
| `POST` | `/api/v1/ledger/reserve/naive` | `spring-ledger` | Intentionally unguarded SQL purchase endpoint demonstrating TOCTOU race conditions. |
| `POST` | `/api/v1/ledger/orders/:id/pay` | `spring-ledger` | Confirms payment for a `PENDING` reservation before the 5-minute Reaper TTL expires. |
| `POST` | `/api/v1/ledger/events/reset` | `spring-ledger` | Resets both PostgreSQL and Redis inventory counters to `100` for a clean benchmark run. |
| `GET` | `/api/v1/ledger/telemetry` | `spring-ledger` | Returns PostgreSQL ground-truth order counts (`pending`, `confirmed`, `expired`, `oversold`). |

---

## 👤 Author

**Mitul Srivastava**
* GitHub: [@Mitul82](https://github.com/Mitul82)