import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import redisClient from '#/database/connectRedis.js';

import type { ReservationResult } from '#/types/ReservationResult.js';

const currentDir = dirname(fileURLToPath(import.meta.url));

type ScriptName = 'reserve' | 'compensate';

const scriptFiles: Record<ScriptName, string> = {
    reserve: 'reserveInventory.lua',
    compensate: 'compensateReservation.lua'
}

const scriptShas: Record<ScriptName, string | null> = { reserve: null, compensate: null };

export const loadLuaScripts = async (): Promise<void> => {
    for (const name of Object.keys(scriptFiles) as ScriptName[]) {
        const source = await readFile(resolve(currentDir, scriptFiles[name]), 'utf-8');

        scriptShas[name] = await redisClient.scriptLoad(source);    
    }
}

const runScript = async (name: ScriptName, keys: string[], args: string[]):Promise<unknown> => {
    try {
        if (!scriptShas[name]) {
            await loadLuaScripts();

            return await redisClient.evalSha(scriptShas[name]!, { keys, arguments: args });
        }
    } catch (err: unknown) {
        if (!(err instanceof Error) || !err.message.includes('NOSCRIPT')) {
            throw err;
        }

        await loadLuaScripts();

        return redisClient.evalSha(scriptShas[name]!, { keys, arguments: args });
    }
}

export const idempotencyKeyFor = (eventId: string, userId: string, key: string): string => (
    `atomix:idemp:${eventId}:${userId}:${key}`
);

const keysFor = (eventId: string, userId: string, key: string): string[] => [
    `atomix:event:${eventId}:stock`,
    `atomix:event:${eventId}:buyers`,
    idempotencyKeyFor(eventId, userId, key),
    `atomix:event:${eventId}:telemetry`
]

export const executeAtomicReservation = async (eventId: string, userId: string, idempotencyKey: string, reservationId: string, ttlSeconds: number = 300): Promise<ReservationResult> => {
    const reply = (await runScript('reserve', keysFor(eventId, userId, idempotencyKey), [userId, ttlSeconds.toString(), reservationId])) as [number, string?]

    switch (reply[0]) {
        case 1:  return { status: 'RESERVED', reservationId };
        case -1: return { status: 'SOLD_OUT' };
        case -2: return { status: 'ALREADY_PURCHASED' };
        case -3: return { status: 'IDEMPOTENT_RETRY', reservationId: reply[1]! };
        default: throw new Error(`Unexpected Lua reply: ${JSON.stringify(reply)}`);
    }
}

export const executeAtomicCompensation = async (eventId: string, userId: string, idempotencyKey: string, reservationId: string): Promise<boolean> => (
    await runScript('compensate', keysFor(eventId, userId, idempotencyKey), [userId, reservationId])
) === 1;