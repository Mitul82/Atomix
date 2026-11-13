import fs from 'fs';
import path from 'node:path';

import { fileURLToPath } from 'node:url';

import redisClient from '#/database/connectRedis.js';

import type { ReservationResult } from '#/types/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let reserveScriptSha: string | null = null;
let rawLuaScript: string = '';

export const loadLuaScript = async (): Promise<void> => {
    const scriptPath = path.join(__dirname, 'reserveInventory.lua');
    rawLuaScript = fs.readFileSync(scriptPath, 'utf8');

    reserveScriptSha = await redisClient.scriptLoad(rawLuaScript);
    console.log(`[NODE BACKEND] Loaded reserveInventory.lua into Redis (SHA: ${reserveScriptSha})`);
}

export const executeAtomicReservation = async (eventId: string, userId: string, idempotencyKey: string, ttlSeconds: number = 300): Promise<ReservationResult> => {
    if (!reserveScriptSha) {
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
        resultCode = (await redisClient.evalSha(reserveScriptSha, {
            keys,
            arguments: args
        })) as number;
    } catch (err: any) {
        if (err?.message?.includes('NOSCRIPT')) {
            reserveScriptSha = await redisClient.scriptLoad(rawLuaScript);
            resultCode = (await redisClient.evalSha(reserveScriptSha, {
                keys,
                arguments: args
            })) as number;
        } else {
            throw err;
        }
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