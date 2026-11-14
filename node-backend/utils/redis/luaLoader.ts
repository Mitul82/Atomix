import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import redisClient from '#/database/connectRedis.js';

import type { ReservationResult } from '#/types/index.js';

const currentDir = dirname(fileURLToPath(import.meta.url));

let reserveSha: string | null = null;
let compensateSha: string | null = null;

export const loadLuaScripts = async (): Promise<void> => {
    const reserveScript = await readFile(resolve(currentDir, 'reserveInventory.lua'), 'utf-8');
    const compensateScript = await readFile(resolve(currentDir, 'compensateReservation.lua'), 'utf-8');

    reserveSha = await redisClient.scriptLoad(reserveScript);
    compensateSha = await redisClient.scriptLoad(compensateScript);
}

export const executeAtomicReservation = async (eventId: string, userId: string, idempotencyKey: string, ttlSeconds: number = 300): Promise<ReservationResult> => {
    if (!reserveSha) {
        throw new Error('Lua script has not been loaded into Redis yet.');
    }

    const keys = [
        `atomix:event:${eventId}:stock`,      // * KEYS[1]
        `atomix:event:${eventId}:buyers`,     // * KEYS[2]
        `atomix:idemp:${idempotencyKey}`,     // * KEYS[3]
        `atomix:event:${eventId}:telemetry`   // * KEYS[4]
    ];

    const args = [
        userId,                               // ? ARGV[1]
        ttlSeconds.toString()                 // ? ARGV[2]
    ];

    let resultCode: number;

    try {
        resultCode = (await redisClient.evalSha(reserveSha, {
            keys,
            arguments: args
        })) as number;
    } catch (err: unknown) {
        console.error('[NODE BACKEND] Error in executing the lua script: ', err);
        throw err;
    }

    switch (resultCode) {
        case 1:
            return 'RESERVED';
        case -1:
            return 'SOLD_OUT';
        case -2:
            return 'ALREADY_PURCHASED';
        case -3:
            return 'IDEMPOTENT_RETRY';
        default:
            throw new Error(`Unexpected Lua return code: ${resultCode}`);
    }
}

export const executeAtomicCompensation = async (eventId: string, userId: string, idempotencyKey: string): Promise<void> => {
    if (!compensateSha) {
        await loadLuaScripts();
    }

    await redisClient.evalSha(compensateSha!, {
        keys: [
            `atomix:event:${eventId}:stock`,
            `atomix:event:${eventId}:buyers`,
            `atomix:idemp:${idempotencyKey}`,
            `atomix:event:${eventId}:telemetry`,
        ],
        arguments: [userId],
    });
};