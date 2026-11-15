import { z } from 'zod';

const safeId = z.string().trim().regex(/^[A-Za-z0-9_-]{1,64}$/, 'must be 1-64 chars: letters, digits, _ or -');
const reserveHeaders = z.object({ 'x-user-id': safeId, 'x-idempotency-key': safeId });

export const reserveRequestSchema = z.object({
    headers: reserveHeaders,
    body: z.object({ eventId: safeId.default('1') })
});

export const reservationStatusSchema = z.object({
    headers: reserveHeaders,
    query: z.object({ eventId: safeId.default('1') })
});

export const telemetryQuerySchema = z.object({
    eventId: z.string().trim().min(1).default('1')
});