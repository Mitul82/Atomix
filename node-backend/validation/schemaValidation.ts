import { z } from 'zod';

export const reserveRequestSchema = z.object({
    headers: z.object({
        'x-user-id': z.string().trim().min(1, 'X-User-Id header is required'),
        'x-idempotency-key': z.string().trim().min(1, 'X-Idempotency-Key header is required')
    }),
    body: z.object({
        eventId: z.string().trim().min(1, 'eventId is required').default('1')
    })
});

export const telemetryQuerySchema = z.object({
    eventId: z.string().trim().min(1).default('1')
});