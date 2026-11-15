import 'dotenv/config';

import express from 'express';

import cors from 'cors';
import helmet from 'helmet';

import { rateLimit } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';

import { startOutbox, stopOutbox } from '#/utils/rabbit/outbox.js';
import { loadLuaScripts } from '#/utils/redis/luaLoader.js';
import connectRabbitmq, { closeRabbitMQ } from '#/database/connectRabbitmq.js';
import redisClient, { connectRedis } from '#/database/connectRedis.js';

import edgeRoutes from '#/routes/edgeRoutes.js';

const app = express();

app.set('trust proxy', 1);

app.use(express.json());

await connectRedis();

app.use(cors({
    origin: process.env.FRONTEND_URL,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Idempotency-Key', 'X-User-Id']
}));

app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            "default-src": ["'self'"],
            "script-src": ["'self'"],
            "style-src": ["'self'", "'unsafe-inline'"],
            "connect-src": ["'self'", process.env.FRONTEND_URL as string, "wss:"],
            "img-src": ["'self'", "data:"],
            "object-src": ["'none'"],
            "base-uri": ["'self'"],
            "frame-ancestors": ["'none'"],
            "upgrade-insecure-requests": []
        }
    }
}));

app.use(rateLimit({
    windowMs: 1 * 60 * 1000,
    max: 50,
    standardHeaders: true,
    legacyHeaders: true,
    store: new RedisStore({
        sendCommand: (...args) => redisClient.sendCommand(args),
        prefix: 'atomix_rl:'
    }),
    keyGenerator: (req: express.Request, res: express.Response) => {
        const userId = req.headers['x-user-id'];

        if(!userId) {
            return `ip:${req.ip}`;
        }

        return `user:${userId}`;
    },
    message: 'Too many requests from this IP/USER, please try again after some time',
    validate: false,
    skip: (req: express.Request) => 
        // * skipping rate limit fro telemetry because that id for monitoring only and atomic reserve because the lua script loaded into redis already acts as a rate limit
        req.path.includes('/telemetry/stream') || req.path.includes('/reserve/atomic')
}));

app.use('/api/v1', edgeRoutes);

const port = process.env.PORT || 3000;

const start = async () => {
    try {
        await loadLuaScripts();
        await connectRabbitmq(process.env.RABBITMQ_URL as string);

        const instance = process.env.NODE_APP_INSTANCE;
        if (instance === undefined || instance === '0') {
            await startOutbox();
        }

        app.listen(port, () =>{
            console.log(`[NODE BACKEND] Server is running on port ${port}...`);
        });

        const shutDown = async () => {
            try {
                stopOutbox();

                await closeRabbitMQ();

                await redisClient.quit();

                console.log('[NODE BACKEND] Connections closed successfully');

                process.exit(0);
            } catch (err: unknown) {
                console.error('[NODE BACKEND] Error in application shutdown: ', err);

                process.exit(1);
            }
        }

        process.on('SIGINT', () => shutDown());
        process.on('SIGTERM', () => shutDown());
    } catch (err: unknown) {
        console.error('[NODE BACEKND] Error in application startup: ', err);

        process.exit(1);
    }
}

start();