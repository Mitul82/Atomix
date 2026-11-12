import React from 'react';

import useTelemetry from '@/hooks/useTelemetry';
import { edgeApi, ledgerApi } from '@/utils/api';

import type { ActiveCustomer } from '@/types';

import Navbar from '@/components/Navbar';
import LoadGenerator from '@/components/LoadGenerator';
import OverSellBanner from '@/components/OverSellBanner';
import CustomerStoreFront from '@/components/CustomerStoreFront';

function App() {
    const [mode, setMode] = React.useState<'ATOMIC' | 'NAIVE'>('ATOMIC');
    const [userId, setUserId] = React.useState<string>(() => `buyer_${Math.floor(1000 + Math.random() * 9000)}`);
    const [idempotencyKey, setIdempotencyKey] = React.useState<string>(() => crypto.randomUUID());

    const [activeOrder, setActiveOrder] = React.useState<ActiveCustomer | null>(null);
    const [countdownSec, setCountdownSec] = React.useState<number>(0);

    const [actionLogs, setActionLogs] = React.useState<string[]>([
        '[SYSTEM] War Room initialized. Connected to Node.js Edge SSE & Spring Boot Ledger.'
    ]);

    const { refreshLedger } = useTelemetry('1');

    const appendLog = (msg: string) => {
        const time = new Date().toLocaleTimeString();
        setActionLogs((prev) => [`[${time}] ${msg}`, ...prev.slice(0, 14)]);
    }

    React.useEffect(() => {
        if (!activeOrder || activeOrder.status === 'CONFIRMED') return;

        const timer = setInterval(() => {
            const remaining = Math.max(0, Math.floor((activeOrder.expiresAtMs - Date.now()) / 1000));
            setCountdownSec(remaining);
            if (remaining === 0) {
                setActiveOrder((prev) => (prev ? { ...prev, status: 'EXPIRED' } : null));
            }
        }, 500);

        return () => clearInterval(timer);
    }, [activeOrder]);

    return (
        <div className='min-h-screen bg-slate-950 text-slate-100 font-sans selection:bg-indigo-500 selection:text-white'>
            <Navbar ledgerApi={ ledgerApi } setActiveOrder={ setActiveOrder } setUserId={ setUserId } setIdempotencyKey={ setIdempotencyKey } appendLog={ appendLog } refreshLedger={ refreshLedger } mode={ mode } setMode={ setMode }/>

            <main className='max-w-7xl mx-auto px-6 py-6 space-y-6'>
                <OverSellBanner/>

                <div className='grid grid-cols-1 lg:grid-cols-12 gap-6'>
                    <CustomerStoreFront activeOrder={ activeOrder } appendLog={ appendLog } countdownSec={ countdownSec } edgeApi={ edgeApi } idempotencyKey={ idempotencyKey } ledgerApi={ ledgerApi } mode={ mode } setActiveOrder={ setActiveOrder } setIdempotencyKey={ setIdempotencyKey } setUserId={ setUserId } userId={ userId }/>

                    <LoadGenerator actionLogs={ actionLogs } appendLog={ appendLog } edgeApi={ edgeApi } mode={ mode }/>
                </div>
            </main>
        </div>
    );
}

export default App;