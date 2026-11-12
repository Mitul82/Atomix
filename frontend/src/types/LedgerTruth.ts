interface LedgerTruth {
    eventId: string,
    productName: string,
    totalInventory: number,
    postgresAvailableInventory: number,
    pendingReservations: number,
    confirmedOrders: number,
    expiredReapedOrders: number,
    totalActiveOrders: number,
    oversoldDiscrepancy: number,
    atomicModeCount: number,
    naiveModeCount: number
}

export type { LedgerTruth }