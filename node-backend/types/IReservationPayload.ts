interface IReservationPayload {
    reservationId: string,
    eventId: string,
    userId: string,
    idempotencyKey: string,
    reservedAt: string
}

export type { IReservationPayload }