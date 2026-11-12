import React from 'react';
import { Zap, ShieldCheck, RotateCcw, Flame } from 'lucide-react';

import useTelemetry from '@/hooks/useTelemetry';

import type { NavbarProps } from '@/types';

function Navbar({ ledgerApi, setActiveOrder, setUserId, setIdempotencyKey, appendLog, refreshLedger, mode, setMode }: NavbarProps) {
    const [isResetting, setIsResetting] = React.useState<boolean>(false);

    const { sseConnected } = useTelemetry('1');

    const handleResetCluster = async () => {
        setIsResetting(true);
        try {
            await ledgerApi.post('/events/reset', { eventId: '1', stock: 100 });
            setActiveOrder(null);
            setUserId(`buyer_${Math.floor(1000 + Math.random() * 9000)}`);
            setIdempotencyKey(crypto.randomUUID());
            appendLog(`🔄 Reset complete! PostgreSQL & Redis inventory restored to 100.`);
            await refreshLedger();
        } catch (err: any) {
            appendLog(`❌ Reset failed: ${err.message}`);
        } finally {
            setIsResetting(false);
        }
    }

    return (
        <header className='border-b border-slate-800 bg-slate-900/80 backdrop-blur sticky top-0 z-30'>
            <div className='max-w-7xl mx-auto px-6 py-4 flex flex-wrap items-center justify-between gap-4'>
                <div className='flex items-center gap-3'>
                    <div className='p-2 rounded-lg bg-indigo-500/10 border border-indigo-500/30 text-indigo-400'>
                        <Zap className='w-6 h-6' />
                    </div>
                    <div>
                        <div className='flex items-center gap-2.5'>
                            <h1 className='text-xl font-bold tracking-tight text-white'>Atomix / SurgeGate</h1>
                            <span
                                className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border ${
                                    sseConnected ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' : 'bg-rose-500/10 text-rose-400 border-rose-500/30'
                                }`}
                            >
                                <span
                                    className={`w-2 h-2 rounded-full ${
                                        sseConnected ? 'bg-emerald-400 animate-pulse' : 'bg-rose-400'
                                    }`}
                                />
                                {sseConnected ? 'SSE Telemetry Live (250ms)' : 'SSE Disconnected'}
                            </span>
                        </div>
                        <p className='text-xs text-slate-400'>
                            Polyglot Flash-Sale Engine • Node.js (TS) + Redis Lua + RabbitMQ + Spring Boot 4
                        </p>
                    </div>
                </div>

                {/* Architecture Mode Toggle & Reset */}
                <div className='flex items-center gap-3'>
                    <div className='inline-flex rounded-lg bg-slate-950 p-1 border border-slate-800'>
                        <button
                            onClick={() => setMode('ATOMIC')}
                            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-md text-xs font-semibold transition ${
                                mode === 'ATOMIC' ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'
                            }`}
                        >
                            <ShieldCheck className='w-4 h-4' />
                            Atomic Mode (Redis Lua + AMQP)
                        </button>
                        <button
                            onClick={() => setMode('NAIVE')}
                            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-md text-xs font-semibold transition ${
                                mode === 'NAIVE' ? 'bg-rose-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'
                            }`}
                        >
                            <Flame className='w-4 h-4' />
                            Naive Mode (Direct SQL Race)
                        </button>
                    </div>

                    <button onClick={handleResetCluster} disabled={isResetting} className='inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition cursor-pointer disabled:opacity-50'>
                        <RotateCcw className={`w-4 h-4 ${isResetting ? 'animate-spin' : ''}`} />
                        Reset Stock (100)
                    </button>
                </div>
            </div>
        </header>
    );
}

export default Navbar;