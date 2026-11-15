/* 
    ? Bash docker command to run the performance test script in ATOMIC mode
    * docker run --rm -i \
    * --network="atomix-network" \
    * --cpu-quota=200000 \
    * --memory="1g" \
    * -e MODE=ATOMIC \
    * grafana/k6 run - < benchmarks/k6-spike-test.js

    ? Powershell command to run the performance test script in ATOMIC mode
    * Get-Content benchmarks/k6-spike-test.js | docker run --rm -i `
    * --network="atomix-network" `
    * --cpu-quota=200000 `
    * --memory="1g" `
    * -e MODE=ATOMIC `
    * grafana/k6 run -
*/

/*
    ? Bash docekr command to run the performance test script in NAIVE mode
    * docker run --rm -i \
    * --network="atomix-network" \
    * --cpu-quota=200000 \
    * --memory="1g" \
    * -e MODE=NAIVE \
    * grafana/k6 run - < benchmarks/k6-spike-test.js

    ? Powershell command to run the perfort script in NAIVE mode
    * Get-Content benchmarks/k6-spike-test.js | docker run --rm -i `
    * --network="atomix-network" `
    * --cpu-quota=200000 `
    * --memory="1g" `
    * -e MODE=NAIVE `
    * grafana/k6 run -
*/

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';

// * Configurable via -e flags in docker run
const MODE = (__ENV.MODE || 'ATOMIC').toUpperCase(); // 'ATOMIC' or 'NAIVE'
const BASE_URL = __ENV.BASE_URL || 'http://nginx-proxy';
const EVENT_ID = __ENV.EVENT_ID || '1';
const INITIAL_STOCK = parseInt(__ENV.STOCK || '100', 10);

// * Custom k6 Metrics for the Final Report
const reservedSuccessCounter = new Counter('orders_accepted_or_confirmed');
const soldOutRejectedCounter = new Counter('orders_rejected_sold_out');
const duplicateRejectedCounter = new Counter('orders_rejected_duplicate');
const rateLimitedCounter = new Counter('orders_rate_limited_429');
const unexpectedErrorCounter = new Counter('orders_unexpected_error');
const reservationLatency = new Trend('reservation_latency_ms', true);

http.setResponseCallback(http.expectedStatuses(200, 201, 202, 409));

export const options = {
    scenarios: {
        sustained_and_spike: {
            executor: 'ramping-vus',
            startVUs: 0,
            stages: [
                { duration: '5s', target: 50 },   // * 1. warm up to sustained 50 VUs
                { duration: '10s', target: 50 },  // * 2. hold sustained baseline load
                { duration: '2s', target: 500 },  // * 3. sudden flash-sale spike to 500 VUs
                { duration: '10s', target: 500 }, // * 4. sustain 500 concurrent VUs hammering the node-service
                { duration: '5s', target: 50 },   // * 5. drop back to sustained baseline
                { duration: '3s', target: 0 },    // * 6. ramp down
            ],
            gracefulRampDown: '5s',
        }
    },
    thresholds: {
        // * Ensure zero 500 Internal Server Errors
        orders_unexpected_error: ['count==0'],
        http_req_duration: ['p(95)<1500'],
    },
};

/*
    * 1. SETUP PHASE: Runs once before the Virtual Users start.
    * Resets PostgreSQL & Redis inventory to 100 so every benchmark starts clean.
*/
export function setup() {
    console.log(`\n=============================================================`);
    console.log(`🚀 INITIALIZING BENCHMARK: MODE = ${MODE}`);
    console.log(`🎯 Target Gateway : ${BASE_URL}`);
    console.log(`📦 Initial Stock  : ${INITIAL_STOCK} units`);
    console.log(`=============================================================\n`);

    const resetRes = http.post(
        `${BASE_URL}/api/v1/ledger/events/reset`,
        JSON.stringify({ eventId: EVENT_ID, stock: INITIAL_STOCK }),
        { headers: { 'Content-Type': 'application/json' } }
    );

    check(resetRes, {
        'Cluster state reset to 100 stock (HTTP 200)': (r) => r.status === 200,
    });

    // * Brief pause to ensure Redis and Postgres state settles
    sleep(0.5);

    return { startTime: Date.now() };
}

/*
    * 2. VU EXECUTION PHASE
*/
export default function () {
    // * Every iteration gets a unique buyer ID so the per-user rate limiter allows the spike
    const uniqueId = `${__VU}_${__ITER}_${Date.now()}`;
    const userId = `k6_buyer_${uniqueId}`;
    const idempotencyKey = `k6_idem_${uniqueId}`;

    const endpoint =
        MODE === 'ATOMIC'
            ? `${BASE_URL}/api/v1/reserve/atomic`
            : `${BASE_URL}/api/v1/ledger/reserve/naive`;

    const payload = JSON.stringify({ eventId: EVENT_ID });

    const params = {
        headers: {
            'Content-Type': 'application/json',
            'X-User-Id': userId,
            'X-Idempotency-Key': idempotencyKey,
        },
        tags: { mode: MODE },
    };

    const res = http.post(endpoint, payload, params);
    reservationLatency.add(res.timings.duration);

    if (res.status === 202 || res.status === 201) {
        // * 202 = Queued at Atomic Edge | 201 = Created in Naive SQL
        reservedSuccessCounter.add(1);
    } else if (res.status === 409) {
        const body = res.json();
        if (body && body.code === 'LIMIT_PER_USER') {
            duplicateRejectedCounter.add(1);
        } else {
            soldOutRejectedCounter.add(1);
        }
    } else if (res.status === 429) {
        rateLimitedCounter.add(1);
    } else {
        unexpectedErrorCounter.add(1);
    }

    check(res, {
        'Valid Flash-Sale HTTP Status (201, 202, or 409 Sold Out)': (r) =>
            r.status === 201 || r.status === 202 || r.status === 409,
    });
}

/*
    * 3. TEARDOWN PHASE: Runs once after all 1,000 requests finish.
    * Queries Spring Boot Ground-Truth Telemetry to verify if overselling occurred.
*/
export function teardown() {
    let data = null, last = -1, stable = 0, waited = 0;

    for (; waited < 60 && stable < 3; waited++) {
        sleep(1);

        const r = http.get(`${BASE_URL}/api/v1/ledger/telemetry?eventId=${EVENT_ID}`);

        if (r.status !== 200) continue;

        data = r.json();

        stable = data.totalActiveOrders === last ? stable + 1 : 0;
        
        last = data.totalActiveOrders;
    }

    console.log(`Queue drained after ~${waited}s`);

    const telemetryRes = http.get(`${BASE_URL}/api/v1/ledger/telemetry?eventId=${EVENT_ID}`);

    if (telemetryRes.status === 200) {
        const data = telemetryRes.json();
        console.log(`\n=============================================================`);
        console.log(`📊 POST-SPIKE LEDGER AUDIT (MODE: ${MODE})`);
        console.log(`=============================================================`);
        console.log(`• Total Initial Stock         : ${data.totalInventory}`);
        console.log(`• Postgres Available Stock    : ${data.postgresAvailableInventory}`);
        console.log(`• Total Active Orders (DB)    : ${data.totalActiveOrders} (Pending: ${data.pendingReservations}, Confirmed: ${data.confirmedOrders})`);
        console.log(`• Oversold Discrepancy        : ${data.oversoldDiscrepancy} units`);
        console.log(`-------------------------------------------------------------`);
        if (data.oversoldDiscrepancy === 0 && data.totalActiveOrders === INITIAL_STOCK) {
            console.log(`✅ VERDICT: PASS — Exact stock match (${INITIAL_STOCK}/${INITIAL_STOCK}) with 0 oversold!`);
        } else {
            console.log(`❌ VERDICT: FAIL — Race condition caused +${data.oversoldDiscrepancy} oversold units!`);
        }
        console.log(`=============================================================\n`);
    }
}