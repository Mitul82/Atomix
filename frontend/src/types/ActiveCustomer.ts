interface ActiveCustomer {
    reservationId: string,
    userId: string,
    mode: 'ATOMIC' | 'NAIVE',
    status: 'QUEUED' | 'CONFIRMED' | 'EXPIRED',
    expiresAtMs: number
}

export type { ActiveCustomer }