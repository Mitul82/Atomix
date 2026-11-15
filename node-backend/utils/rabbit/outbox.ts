import redisClient from '#/database/connectRedis.js';

import publishReservation from '#/utils/rabbit/publish.js';

export const outboxKey = 'atomix:outbox';
export const outboxProcessingKey = 'atomix:outbox:processing';

let timer: NodeJS.Timeout | null = null;
let running = false;

const tick = async () => {
    if (running) {
        return;
    }

    running = true;

    try {
        for (let i = 0; i < 100; i++) {
            const raw = await redisClient.lMove(outboxKey, outboxProcessingKey, 'LEFT', 'RIGHT');

            if (!raw) {
                return
            }

            const { reservationId } = JSON.parse(raw) as { reservationId: string };

            const outcome = await publishReservation(reservationId, Buffer.from(raw));

            await redisClient.lRem(outboxProcessingKey, 1, raw);

            if (outcome !== 'CONFIRMED') {
                await redisClient.rPush(outboxKey, raw);

                return;
            }
        }
    } catch (err: unknown) {
        console.error('[NODE BACKEND] Error in outbix: ', err);
    } finally {
        running = false;
    }
}

export const startOutbox = async (): Promise<void> => {
    while (await redisClient.lMove(outboxProcessingKey, outboxKey, 'RIGHT', 'LEFT'));

    timer = setInterval(tick, 1000);
}

export const stopOutbox = async () => {
    if (timer) {
        clearInterval(timer);
    }

    timer = null;
}