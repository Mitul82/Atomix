type ReservationResult = 
    | { status: 'RESERVED'; reservationId: string }
    | { status: 'IDEMPOTENT_RETRY'; reservationId: string }
    | { status: 'SOLD_OUT' }
    | { status: 'ALREADY_PURCHASED' }

export type { ReservationResult }