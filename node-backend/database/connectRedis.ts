import { createClient } from 'redis';

const redisClient = createClient({
    url: process.env.REDIS_URL
});

redisClient.on('connect', () => {
    console.log('[NODE BACKEND] Connected to redis...');
});

redisClient.on('error', (err) => {
    console.error('[NODE BACKEND] Error in connecting to redis: ', err);
});

export const connectRedis = async () => {
    if(!redisClient.isOpen) {
        await redisClient.connect();
    }
}

export default redisClient;