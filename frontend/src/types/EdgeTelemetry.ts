interface EdgeTelemetry {
    eventId: string,
    timestamp: string,
    redisStockRemaining: number,
    uniqueBuyersCount: number,
    acceptedAtEdge: number,
    rejectedSoldOut: number,
    rejectedDuplicate: number,
    postgresPersisted: number,
    reaperRestored: number
}

export type { EdgeTelemetry }