import React from 'react';

import { ledgerApi, EDGE_URL } from '@/utils/api';

import type { EdgeTelemetry, LedgerTruth } from '@/types';

const useTelemetry = (eventId: string = '1') => {
    const [edgeMetrics, setEdgeMetrics] = React.useState<EdgeTelemetry>({
        eventId,
        timestamp: new Date().toISOString(),
        redisStockRemaining: 100,
        uniqueBuyersCount: 0,
        acceptedAtEdge: 0,
        rejectedSoldOut: 0,
        rejectedDuplicate: 0,
        postgresPersisted: 0,
        reaperRestored: 0
    });

    const [ledgerMetrics, setLedgerMetrics] = React.useState<LedgerTruth>({
        eventId,
        productName: 'Atomix Founders Edition Mechanical Keyboard',
        totalInventory: 100,
        postgresAvailableInventory: 100,
        pendingReservations: 0,
        confirmedOrders: 0,
        expiredReapedOrders: 0,
        totalActiveOrders: 0,
        oversoldDiscrepancy: 0,
        atomicModeCount: 0,
        naiveModeCount: 0
    });

    const [sseConnected, setSseConnected] = React.useState<boolean>(false);

    const fetchLedgerGroundTruth = React.useCallback(async () => {
        try {
            const { data } = await ledgerApi.get<LedgerTruth>(`/telemetry?eventId=${eventId}`);
            setLedgerMetrics(data);
        } catch (err) {
            console.error('[WAR ROOM] Failed to fetch Spring Boot ledger telemetry:', err);
        }
    }, [eventId]);

    React.useEffect(() => {
        // * connect to the node.js SSE stream
        const sseUrl = `${EDGE_URL}/telemetry/stream?eventId=${eventId}`;
        const eventSource = new EventSource(sseUrl);

        eventSource.onopen = () => setSseConnected(true);

        eventSource.onmessage = (event) => {
            try {
                const parsed: EdgeTelemetry = JSON.parse(event.data);
                setEdgeMetrics(parsed);
            } catch (e) {
                console.error('[WAR ROOM] Failed to parse SSE payload:', e);
            }
        };

        eventSource.onerror = () => {
            setSseConnected(false);
        };

        // * poll the spring ledger every 1 second
        fetchLedgerGroundTruth();
        const interval = setInterval(fetchLedgerGroundTruth, 1000);

        return () => {
            eventSource.close();
            clearInterval(interval);
        };
    }, [eventId, fetchLedgerGroundTruth]);

    return {
        edgeMetrics,
        ledgerMetrics,
        sseConnected,
        refreshLedger: fetchLedgerGroundTruth
    }
}

export default useTelemetry;