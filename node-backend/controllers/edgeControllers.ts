import crypto from 'node:crypto';

import redisClient from '#/database/connectRedis.js';

import publishReservation from '#/utils/rabbit/publish.js';
import { outboxKey } from '#/utils/rabbit/outbox.js';
import { executeAtomicReservation, executeAtomicCompensation, idempotencyKeyFor } from '#/utils/redis/luaLoader.js';
import { reserveRequestSchema, reservationStatusSchema, telemetryQuerySchema } from '#/validation/schemaValidation.js';

import type { Request, Response } from 'express';

import { IReservationPayload } from '#/types/IReservationPayload.js';

const soldOutCache = new Map<string, number>();

const atomicReserve = async (req: Request, res: Response) => {
    try {
        const parsed = reserveRequestSchema.safeParse({ headers: req.headers, body: req.body ?? {} });

        if (!parsed.success) return res.status(400).json({ success: false, message: parsed.error.flatten() });

        const userId = parsed.data.headers['x-user-id'];
        const idempotencyKey = parsed.data.headers['x-idempotency-key'];
        const { eventId } = parsed.data.body;

        const cacheUntil = soldOutCache.get(eventId);

        if (cacheUntil && Date.now() < cacheUntil) {
            return res.status(409).json({ success: false, code: 'SOLD_OUT', message: 'Sold out. If you already reserved, check GET /api/v1/reserve/status.' });
        }

        const reservationId = crypto.randomUUID();
        const result = await executeAtomicReservation(eventId, userId, idempotencyKey, reservationId, 300);

        switch (result.status) {
            case 'RESERVED': {
                const payload: IReservationPayload = {
                    eventId, idempotencyKey, reservationId, userId, reservedAt: new Date().toISOString()
                }

                const outcome = await publishReservation(reservationId, Buffer.from(JSON.stringify(payload)));

                if (outcome === 'REJECTED') {
                    try { 
                        await executeAtomicCompensation(eventId, userId, idempotencyKey, reservationId); 
                    } catch (e: unknown) { 
                        console.error('[CRITICAL] compensation failed', { eventId, userId, reservationId }, e);
                    }

                    return res.status(503).set('Retry-After', '1').json({ success: false, message: 'Order queue unavailable. Please retry.' });
                }

                if (outcome === 'UNKNOWN') {
                    await redisClient.rPush(outboxKey, JSON.stringify(payload));
                }

                return res.status(202).json({ status: 'QUEUED', message: 'Inventory reserved at edge and queued for ledger persistence.', reservationId, eventId, userId, reservedAt: payload.reservedAt });
            }
            case 'IDEMPOTENT_RETRY':
                return res.status(202).json({ status: 'QUEUED', replay: true, reservationId: result.reservationId, eventId, userId });
            case 'SOLD_OUT':
                soldOutCache.set(eventId, Date.now() + 250);

                return res.status(409).json({ success: false, code: 'SOLD_OUT', message: 'Flash sale inventory is completely exhausted.' });
            case 'ALREADY_PURCHASED':
                return res.status(409).json({ success: false, code: 'LIMIT_PER_USER', message: 'Limit 1 item per user for this flash sale event.' });
        }
    } catch (err: unknown) {
        console.error('[NODE BACKEND] Error in atomicReserve controller: ', err);

        return res.status(500).json({ success: false, message: 'Internal Server error' });
    }
}

const seedRedis = async (req: Request, res: Response) => {
    try {
        const eventId = (req.body?.eventId as string) || '1';
        const initialStock = Number(req.body?.stock ?? 100);

        soldOutCache.delete(eventId);

        const response = await fetch(`${process.env.LEDGER_URL}/api/v1/ledger/events/reset`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ eventId, stock: initialStock })
        });

        if (!response.ok) {
            return res.status(502).json({ success: false, message: `Ledger reset failed (${response.status})` });
        }

        return res.status(200).json({ success: true, message: `Event ${eventId} reset to stock = ${initialStock}`, eventId, stock: initialStock });
    } catch (err: unknown) {
        console.error('[NODE BACKEND] Error in seedRedis controller: ', err);

        return res.status(500).json({ success: false, message: 'Internal Server error' });
    }
}

const getTelemetry = async (req: Request, res: Response) => {
    try {
        const { eventId } = telemetryQuerySchema.parse(req.query);

        // * Required headers for SSE (X-Accel-Buffering prevents Nginx from buffering chunks)
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
        res.flushHeaders();

        let isStreamClosed = false;

        const stockKey = `atomix:event:${eventId}:stock`;
        const buyersKey = `atomix:event:${eventId}:buyers`;
        const telemetryKey = `atomix:event:${eventId}:telemetry`;

        const pushTelemetry = async () => {
            if (isStreamClosed || res.writableEnded) return;
            
            try {
                const [rawStock, uniqueBuyers, telemetryHash] = await Promise.all([
                    redisClient.get(stockKey),
                    redisClient.sCard(buyersKey),
                    redisClient.hGetAll(telemetryKey)
                ]);

                const payload = {
                    eventId,
                    timestamp: new Date().toISOString(),
                    redisStockRemaining: Number(rawStock ?? 0),
                    uniqueBuyersCount: Number(uniqueBuyers ?? 0),
                    acceptedAtEdge: Number(telemetryHash.accepted_at_edge ?? 0),
                    rejectedSoldOut: Number(telemetryHash.rejected_sold_out ?? 0),
                    rejectedDuplicate: Number(telemetryHash.rejected_duplicate ?? 0),
                    postgresPersisted: Number(telemetryHash.postgres_persisted ?? 0),
                    reaperRestored: Number(telemetryHash.reaper_restored ?? 0)
                };

                res.write(`data: ${JSON.stringify(payload)}\n\n`);
            } catch (err) {
                console.error('[NODE BACKEND] Error pushing SSE telemetry:', err);

                if (!isStreamClosed && !res.writableEnded) {
                    res.write(`event: error\ndata: ${JSON.stringify({ message: 'Telemetry read error' })}\n\n`);
                }
            }
        };

        // * Push initial snapshot immediately, then every 250ms
        await pushTelemetry();
        const intervalId = setInterval(pushTelemetry, 250);

        // * Clean up timer when browser closes the SSE tab
        req.on('close', () => {
            isStreamClosed = true;
            clearInterval(intervalId);
            res.end();
        });
    } catch (err: unknown) {
        console.error('[NODE BACKEND] Error in getTelemetry controller: ', err);

        return res.status(500).json({ success: false, message: 'Internal Server error' });
    }
}

const simulateSpike = async (req: Request, res: Response) => {
    try {
        const mode: 'ATOMIC' | 'NAIVE' = req.body?.mode === 'NAIVE' ? 'NAIVE' : 'ATOMIC';
        const concurrency = Math.min(Number(req.body?.concurrency ?? 500), 2000);
        const eventId = String(req.body?.eventId ?? '1');

        const edgeUrl = `http://localhost:${process.env.PORT}/api/v1/reserve/atomic`;
        const ledgerUrl = `${process.env.LEDGER_URL}/api/v1/ledger/reserve/naive`;
        const targetUrl = mode === 'ATOMIC' ? edgeUrl : ledgerUrl;

        const batchId = crypto.randomUUID().slice(0, 8);
        const startTime = performance.now();

        const requests = Array.from({ length: concurrency }, (_, i) => {
            const userId = `sim_user_${batchId}_${i + 1}`;
            const idempotencyKey = `sim_idem_${batchId}_${i + 1}`;
    
            return fetch(targetUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-User-Id': userId,
                    'X-Idempotency-Key': idempotencyKey
                },
                body: JSON.stringify({ eventId })
            })
                .then((r) => r.status)
                .catch(() => 500);
        });
    
        const statuses = await Promise.all(requests);
        const durationMs = Math.round(performance.now() - startTime);
    
        const summary = statuses.reduce<Record<number, number>>((acc, code) => {
            acc[code] = (acc[code] || 0) + 1;
            return acc;
        }, {});
    
        return res.status(200).json({ mode, concurrency, durationMs, statusBreakdown: summary });
    } catch (err: unknown) {
        console.error('[NODE BACKEND] Error in the simpulateSpike controller: ', err);

        return res.status(500).json({ success: false, message: 'Internal Server error' });
    }
}

const reservationStatus = async (req: Request, res: Response) => {
    try {
        const parsed = reservationStatusSchema.safeParse({ headers: req.headers, query: req.query });

        if (!parsed.success) return res.status(400).json({ success: false, message: parsed.error.flatten() });

        const reservationId = await redisClient.get(idempotencyKeyFor(parsed.data.query.eventId, parsed.data.headers['x-user-id'], parsed.data.headers['x-idempotency-key']));

        return reservationId ? res.status(200).json({ reserved: true, reservationId }) : res.status(404).json({ reserved: false });
    } catch (err: unknown) {
        console.error('[NODE BACKEND] Error in reservationStatus controller: ', err);

        return res.status(500).json({ success: false, message: 'Internal Server error' });
    }
};

export { atomicReserve, seedRedis, getTelemetry, simulateSpike, reservationStatus }