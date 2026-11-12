import express from 'express';

const router = express.Router();

import { getTelemetry, atomicReserve, seedRedis, simulateSpike } from '@/controllers/edgeControllers.js';

router.get('/telemetry/stream', getTelemetry);
router.post('/reserve/atomic', atomicReserve);
router.post('/simulate-spike', simulateSpike)
router.post('/seed', seedRedis);

export default router;