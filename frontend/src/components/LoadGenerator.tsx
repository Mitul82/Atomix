import React from 'react';
import { Zap, Activity, Database, Server, Flame, Layers, Terminal } from 'lucide-react';

import useTelemetry from '@/hooks/useTelemetry';

import type { LoadGeneratorProps } from '@/types/LoadGeneratorProps';

function LoadGenerator({ mode, appendLog, edgeApi, actionLogs }: LoadGeneratorProps) {
    const [isSimulating, setIsSimulating] = React.useState<boolean>(false);

    const { refreshLedger, edgeMetrics, ledgerMetrics } = useTelemetry('1');

    const handleSimulateSpike = async (concurrency: number) => {
        setIsSimulating(true);
        appendLog(`🚀 Launching ${concurrency} concurrent requests in ${mode} mode...`);
        try {
            const { data } = await edgeApi.post('/simulate-spike', {
                mode,
                concurrency,
                eventId: '1'
            });
            appendLog(
                `⚡ Spike finished in ${data.durationMs}ms! Status breakdown: ${JSON.stringify(data.statusBreakdown)}`
            );
            await refreshLedger();
        } catch (err: any) {
            appendLog(`❌ Spike simulation error: ${err.message}`);
        } finally {
            setIsSimulating(false);
        }
    }

    const inFlightRabbitMq = Math.max(0, edgeMetrics.acceptedAtEdge - edgeMetrics.postgresPersisted);
    const isOversold = ledgerMetrics.oversoldDiscrepancy > 0 || ledgerMetrics.postgresAvailableInventory < 0;

    return (
        <section className='lg:col-span-7 bg-slate-900 border border-slate-800 rounded-2xl p-6 flex flex-col justify-between space-y-6'>
            <div className='space-y-4'>
                <div className='flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-4'>
                    <div className='flex items-center gap-2.5'>
                        <Activity className='w-5 h-5 text-emerald-400' />
                        <h2 className='font-bold text-base text-white'>
                            Chaos Load Generator & Distributed Pipeline Telemetry
                        </h2>
                    </div>
                    <span className='text-xs font-mono text-slate-400'>
                        Target: <strong className='text-white'>{mode}</strong>
                    </span>
                </div>

                <div className='grid grid-cols-1 sm:grid-cols-2 gap-3'>
                    <button
                        onClick={() => handleSimulateSpike(250)}
                        disabled={isSimulating}
                        className='p-3.5 rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-800 flex items-center justify-between transition cursor-pointer disabled:opacity-50'
                    >
                        <div className='text-left'>
                            <div className='text-xs font-bold text-white flex items-center gap-1.5'>
                                <Zap className='w-4 h-4 text-amber-400' />
                                Fire 250 Concurrent Buyers
                            </div>
                            <div className='text-[11px] text-slate-400 mt-0.5'>
                                2.5x Oversubscription Burst
                            </div>
                        </div>
                        <span className='px-2.5 py-1 rounded bg-amber-500/10 text-amber-300 font-mono text-xs font-bold'>
                            250 VUs
                        </span>
                    </button>

                    <button
                        onClick={() => handleSimulateSpike(500)}
                        disabled={isSimulating}
                        className='p-3.5 rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-800 flex items-center justify-between transition cursor-pointer disabled:opacity-50'
                    >
                        <div className='text-left'>
                            <div className='text-xs font-bold text-white flex items-center gap-1.5'>
                                <Flame className='w-4 h-4 text-rose-400' />
                                Fire 500 Concurrent Buyers
                            </div>
                            <div className='text-[11px] text-slate-400 mt-0.5'>
                                5x Extreme Contention Spike
                            </div>
                        </div>
                        <span className='px-2.5 py-1 rounded bg-rose-500/10 text-rose-300 font-mono text-xs font-bold'>
                            500 VUs
                        </span>
                    </button>
                </div>

                <div className='grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2'>
                    <div className='p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-2'>
                        <div className='flex items-center justify-between text-xs text-slate-400'>
                            <span className='font-semibold uppercase'>1. Redis Lua Edge</span>
                            <Server className='w-4 h-4 text-indigo-400' />
                        </div>
                        <div className='text-2xl font-black font-mono text-white'>
                            {edgeMetrics.redisStockRemaining}
                            <span className='text-xs font-normal text-slate-500 ml-1'>stock left</span>
                        </div>
                        <div className='text-[11px] font-mono text-slate-400 space-y-1 pt-2 border-t border-slate-900'>
                            <div className='flex justify-between'>
                                <span>Accepted (202):</span>
                                <span className='text-emerald-400 font-bold'>
                                    {edgeMetrics.acceptedAtEdge}
                                </span>
                            </div>
                            <div className='flex justify-between'>
                                <span>Rejected (Sold Out):</span>
                                <span className='text-amber-400 font-bold'>
                                    {edgeMetrics.rejectedSoldOut}
                                </span>
                            </div>
                            <div className='flex justify-between'>
                                <span>Rejected (1/User):</span>
                                <span className='text-rose-400 font-bold'>
                                    {edgeMetrics.rejectedDuplicate}
                                </span>
                            </div>
                        </div>
                    </div>

                    <div className='p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-2'>
                        <div className='flex items-center justify-between text-xs text-slate-400'>
                            <span className='font-semibold uppercase'>2. RabbitMQ Queue</span>
                            <Layers className='w-4 h-4 text-amber-400' />
                        </div>
                        <div className='text-2xl font-black font-mono text-amber-400'>
                            {inFlightRabbitMq}
                            <span className='text-xs font-normal text-slate-500 ml-1'>in-flight</span>
                        </div>
                        <div className='text-[11px] font-mono text-slate-400 space-y-1 pt-2 border-t border-slate-900'>
                            <div className='flex justify-between'>
                                <span>Prefetch Limit:</span>
                                <span className='text-slate-200'>25 msgs</span>
                            </div>
                            <div className='flex justify-between'>
                                <span>Drained to DB:</span>
                                <span className='text-emerald-400 font-bold'>
                                    {edgeMetrics.postgresPersisted}
                                </span>
                            </div>
                            <div className='flex justify-between'>
                                <span>Reaper Restored:</span>
                                <span className='text-indigo-400 font-bold'>
                                    {edgeMetrics.reaperRestored}
                                </span>
                            </div>
                        </div>
                    </div>

                    <div className='p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-2'>
                        <div className='flex items-center justify-between text-xs text-slate-400'>
                            <span className='font-semibold uppercase'>3. Postgres Ledger</span>
                            <Database className='w-4 h-4 text-emerald-400' />
                        </div>
                        <div
                            className={`text-2xl font-black font-mono ${
                                isOversold ? 'text-rose-400' : 'text-emerald-400'
                            }`}
                        >
                            {ledgerMetrics.totalActiveOrders}
                            <span className='text-xs font-normal text-slate-500 ml-1'>active orders</span>
                        </div>
                        <div className='text-[11px] font-mono text-slate-400 space-y-1 pt-2 border-t border-slate-900'>
                            <div className='flex justify-between'>
                                <span>DB Stock Column:</span>
                                <span
                                    className={`font-bold ${
                                        ledgerMetrics.postgresAvailableInventory < 0
                                            ? 'text-rose-400'
                                            : 'text-white'
                                    }`}
                                >
                                    {ledgerMetrics.postgresAvailableInventory}
                                </span>
                            </div>
                            <div className='flex justify-between'>
                                <span>Pending / Paid:</span>
                                <span className='text-slate-200'>
                                    {ledgerMetrics.pendingReservations} / {ledgerMetrics.confirmedOrders}
                                </span>
                            </div>
                            <div className='flex justify-between'>
                                <span>Expired (Reaped):</span>
                                <span className='text-indigo-400'>
                                    {ledgerMetrics.expiredReapedOrders}
                                </span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <div className='bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-2'>
                <div className='flex items-center justify-between text-xs text-slate-400 border-b border-slate-900 pb-2'>
                    <span className='font-mono font-semibold flex items-center gap-1.5'>
                        <Terminal className='w-3.5 h-3.5 text-indigo-400' />
                        Live Execution Stream
                    </span>
                    <span className='font-mono text-[11px] text-slate-500'>
                        Atomic: {ledgerMetrics.atomicModeCount} | Naive: {ledgerMetrics.naiveModeCount}
                    </span>
                </div>
                <div className='h-36 overflow-y-auto font-mono text-xs space-y-1.5 text-slate-300'>
                    {actionLogs.map((log: string, index: number) => (
                        <div key={index} className='leading-relaxed'>
                            {log}
                        </div>
                    ))}
                </div>
            </div>
        </section>
    );
}

export default LoadGenerator;