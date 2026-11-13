import crypto from 'node:crypto';

import redisClient from '#/database/connectRedis.js';

import { getChannel } from '#/database/connectRabbitmq.js';
import { executeAtomicReservation } from '#/utils/redis/luaLoader.js';
import { exchangeName, routingKey } from '#/queues/reservationQueue.js';
import { reserveRequestSchema, telemetryQuerySchema } from '#/validation/schemaValidation.js';

import type { Request, Response } from 'express';
import { IReservationPayload } from '#/types/IReservationPayload.js';
import { number } from 'zod';

const atomicReserve = async (req: Request, res: Response) => {
    try {
        const channel = getChannel();

        const parsed = reserveRequestSchema.safeParse({
            headers: req.headers,
            body: req.body ?? {}
        });

        if(!parsed.success) {
            return res.status(400).json({ success: false, message: parsed.error.flatten() });
        }

        const userId = parsed.data.headers['x-user-id'];
        const idempotencyKey = parsed.data.headers['x-idempotency-key'];
        const { eventId } = parsed.data.body;

        const luaResult = await executeAtomicReservation(eventId, userId, idempotencyKey, 300);
        
        switch(luaResult) {
            case 'RESERVED':{
                const reservationId = crypto.randomUUID();
                const reservedAt = new Date().toISOString();

                const payload: IReservationPayload = {
                    eventId,
                    idempotencyKey,
                    reservationId,
                    reservedAt,
                    userId
                }

                const messageBuffer = Buffer.from(JSON.stringify(payload));

                channel.publish(exchangeName, routingKey, messageBuffer, {
                    persistent: true,
                    contentType: 'application/json',
                    timestamp: Date.now()
                });

                return res.status(202).json({ status: 'QUEUED', message: 'Inventory reserved at edge and queued for ledger persistence.', reservationId, eventId, userId, reservedAt });
            }
            
            case 'SOLD_OUT': {
                return res.status(409).json({ success: false, message: 'Flash sale inventory is completely exhausted.' });
            }

            case 'ALREADY_PURCHASED': {
                return res.status(409).json({ success: false, message: 'Limit 1 item per user for this flash sale event.' });
            }

            case 'IDEMPOTENT_RETRY': {
                return res.status(200).json({ success: false, message: 'Request with this X-Idempotency-Key was already processed.' });
            }
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

        const stockKey = `atomix:event:${eventId}:stock`;
        const buyersKey = `atomix:event:${eventId}:buyers`;
        const telemetryKey = `atomix:event:${eventId}:telemetry`;

        await Promise.all([
            redisClient.set(stockKey, initialStock.toString()),
            redisClient.del(buyersKey),
            redisClient.del(telemetryKey),
            redisClient.hSet(telemetryKey, {
                accepted_at_edge: '0',
                rejected_sold_out: '0',
                rejected_duplicate: '0',
                postgres_persisted: '0',
                reaper_restored: '0'
            })
        ]);

       return res.status(200).json({ success: false, message: `Redis state initialized for event ${eventId} with stock = ${initialStock}`, eventId, stock: initialStock });
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

        const stockKey = `atomix:event:${eventId}:stock`;
        const buyersKey = `atomix:event:${eventId}:buyers`;
        const telemetryKey = `atomix:event:${eventId}:telemetry`;

        const pushTelemetry = async () => {
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

                return res.status(500).json({ success: false, message: 'Internal Server error' });
            }
        };

        // * Push initial snapshot immediately, then every 250ms
        await pushTelemetry();
        const intervalId = setInterval(pushTelemetry, 250);

        // * Clean up timer when browser closes the SSE tab
        req.on('close', () => {
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
        const concurrency = Math.min(Number(req.body?.concurency ?? 500), 2000);
        const eventId = String(req.body?.eventId ?? '1');

        const edgeUrl = `http://localhost:${process.env.PORT}/api/v1/edge/reserve/atomic`;
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

export { atomicReserve, seedRedis, getTelemetry, simulateSpike }