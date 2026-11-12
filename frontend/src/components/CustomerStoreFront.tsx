import { ShoppingCart, Clock, CheckCircle2, Zap } from 'lucide-react';

import useTelemetry from '@/hooks/useTelemetry';

import type { CustomerStoreFrontProps } from '@/types';

function CustomerStoreFront({ setUserId, setIdempotencyKey, userId, idempotencyKey, mode, activeOrder, appendLog, edgeApi, setActiveOrder, ledgerApi, countdownSec }: CustomerStoreFrontProps) {
    const { edgeMetrics, ledgerMetrics, refreshLedger } = useTelemetry('1');

    const stockPercent = Math.max(
        0,
        Math.min(100, Math.round((edgeMetrics.redisStockRemaining / ledgerMetrics.totalInventory) * 100))
    );

    const handleSinglePurchase = async () => {
        try {
            if (mode === 'ATOMIC') {
                appendLog(`Sending ATOMIC reservation (User: ${userId}, IdemKey: ${idempotencyKey.slice(0, 8)}...)`);
                const { data, status } = await edgeApi.post(
                    '/reserve/atomic',
                    { eventId: '1' },
                    {
                        headers: {
                            'X-User-Id': userId,
                            'X-Idempotency-Key': idempotencyKey
                        }
                    }
                );
    
                if (status === 200 && data.status === 'IDEMPOTENT_RETRY') {
                    appendLog(`⚠️ IDEMPOTENT RETRY: Duplicate request blocked safely without double-charging.`);
                    return;
                }
    
                setActiveOrder({
                    reservationId: data.reservationId,
                    userId,
                    mode: 'ATOMIC',
                    status: 'QUEUED',
                    expiresAtMs: Date.now() + 300 * 1000
                });
                appendLog(`✅ HTTP 202 Accepted! Reserved in Redis Lua & queued in RabbitMQ (ID: ${data.reservationId.slice(0, 8)}).`);
            } else {
                appendLog(`Sending NAIVE SQL purchase directly to Spring Boot (User: ${userId})...`);
                const { data } = await ledgerApi.post(
                    '/reserve/naive',
                    { eventId: '1' },
                    {
                        headers: {
                            'X-User-Id': userId,
                            'X-Idempotency-Key': idempotencyKey
                        }
                    }
                );
                setActiveOrder({
                    reservationId: data.reservationId,
                    userId,
                    mode: 'NAIVE',
                    status: 'CONFIRMED',
                    expiresAtMs: Date.now() + 300 * 1000
                });
                appendLog(`💥 Naive SQL order written directly to PostgreSQL (ID: ${String(data.reservationId).slice(0, 8)}).`);
            }

            await refreshLedger();
        } catch (err: any) {
            const errStatus = err.response?.status;
            const errData = err.response?.data;
            appendLog(`❌ Rejected (HTTP ${errStatus ?? 'ERR'}): ${errData?.message || errData?.error || err.message}`);
        }
    }

    const handleConfirmPayment = async () => {
        if (!activeOrder) return;
        try {
            await ledgerApi.post(`/orders/${activeOrder.reservationId}/pay`);
            setActiveOrder({ ...activeOrder, status: 'CONFIRMED' });
            appendLog(`💳 Payment confirmed in PostgreSQL Ledger for Order ${activeOrder.reservationId.slice(0, 8)}!`);
            await refreshLedger();
        } catch (err: any) {
            appendLog(`❌ Payment failed: ${err.response?.data?.error || err.message}`);
        }
    }

    return (
        <section className='lg:col-span-5 bg-slate-900 border border-slate-800 rounded-2xl p-6 flex flex-col justify-between space-y-6'>
            <div className='space-y-5'>
                <div className='flex items-center justify-between border-b border-slate-800 pb-4'>
                    <div className='flex items-center gap-2.5'>
                        <ShoppingCart className='w-5 h-5 text-indigo-400' />
                        <h2 className='font-bold text-base text-white'>Customer Flash-Sale Storefront</h2>
                    </div>
                    <span className='text-xs px-2.5 py-1 rounded bg-slate-800 text-slate-300 font-mono'>
                        Event #1
                    </span>
                </div>

                <div className='p-4 rounded-xl bg-slate-950/70 border border-slate-800/80 space-y-3'>
                    <span className='text-[11px] font-semibold uppercase tracking-wider text-indigo-400'>
                        Limited Edition Drop
                    </span>
                    <h3 className='text-lg font-bold text-white'>{ledgerMetrics.productName}</h3>
                    <div className='flex items-baseline gap-3'>
                        <span className='text-2xl font-extrabold text-white'>₹4,999</span>
                        <span className='text-sm text-slate-500 line-through'>₹12,999</span>
                        <span className='text-xs font-semibold text-emerald-400 ml-auto'>
                            Limit 1 Per Customer
                        </span>
                    </div>

                    <div className='space-y-1.5 pt-2'>
                        <div className='flex justify-between text-xs font-mono'>
                            <span className='text-slate-400'>Edge Available Stock:</span>
                            <span className='font-bold text-white'>
                                {edgeMetrics.redisStockRemaining} / {ledgerMetrics.totalInventory}
                            </span>
                        </div>
                        <div className='w-full h-2.5 bg-slate-800 rounded-full overflow-hidden'>
                            <div
                                className={`h-full transition-all duration-300 ${
                                    edgeMetrics.redisStockRemaining > 20
                                        ? 'bg-indigo-500'
                                        : edgeMetrics.redisStockRemaining > 0
                                        ? 'bg-amber-500'
                                        : 'bg-rose-600'
                                }`}
                                style={{ width: `${stockPercent}%` }}
                            />
                        </div>
                    </div>
                </div>

                <div className='space-y-3 bg-slate-950/50 p-4 rounded-xl border border-slate-800/70'>
                    <div className='flex items-center justify-between'>
                        <span className='text-xs font-semibold text-slate-300 uppercase tracking-wider'>
                            Simulated Request Headers
                        </span>
                        <button
                            onClick={() => {
                                setUserId(`buyer_${Math.floor(1000 + Math.random() * 9000)}`);
                                setIdempotencyKey(crypto.randomUUID());
                            }}
                            className='text-xs text-indigo-400 hover:text-indigo-300 underline cursor-pointer'
                        >
                            Generate New Buyer & Key
                        </button>
                    </div>

                    <div className='space-y-2'>
                        <div>
                            <label className='text-[11px] text-slate-400 font-mono block mb-1'>
                                X-User-Id (Tests 1-Per-User Set Lock)
                            </label>
                            <input
                                type='text'
                                value={userId}
                                onChange={(e) => setUserId(e.target.value)}
                                className='w-full px-3 py-1.5 rounded bg-slate-900 border border-slate-700 text-xs font-mono text-white'
                            />
                        </div>

                        <div>
                            <div className='flex justify-between'>
                                <label className='text-[11px] text-slate-400 font-mono block mb-1'>
                                    X-Idempotency-Key (Prevents Double-Click Retries)
                                </label>
                                <button
                                    onClick={() => setIdempotencyKey(crypto.randomUUID())}
                                    className='text-[11px] text-slate-400 hover:text-white cursor-pointer'
                                >
                                    Rotate Key
                                </button>
                            </div>
                            <input
                                type='text'
                                value={idempotencyKey}
                                onChange={(e) => setIdempotencyKey(e.target.value)}
                                className='w-full px-3 py-1.5 rounded bg-slate-900 border border-slate-700 text-xs font-mono text-slate-300'
                            />
                        </div>
                    </div>
                </div>

                <button
                    onClick={handleSinglePurchase}
                    className={`w-full py-3 px-4 rounded-xl font-bold text-sm shadow-lg transition flex items-center justify-center gap-2 cursor-pointer ${
                        mode === 'ATOMIC' ? 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-indigo-950/50' : 'bg-rose-600 hover:bg-rose-500 text-white shadow-rose-950/50'
                    }`}
                >
                    <Zap className='w-4 h-4' />
                    {mode === 'ATOMIC'
                        ? 'Buy Now via Atomic Edge Gatekeeper'
                        : 'Buy Now via Naive SQL Endpoint'}
                </button>
            </div>

            {activeOrder && (
                <div className='p-4 rounded-xl bg-indigo-950/30 border border-indigo-500/40 space-y-3'>
                    <div className='flex items-center justify-between'>
                        <span className='text-xs font-bold uppercase tracking-wider text-indigo-300 flex items-center gap-1.5'>
                            <Clock className='w-4 h-4' />
                            Active Order Reservation
                        </span>
                        <span
                            className={`text-xs font-mono px-2 py-0.5 rounded font-semibold ${
                                activeOrder.status === 'CONFIRMED'
                                    ? 'bg-emerald-500/20 text-emerald-300'
                                    : activeOrder.status === 'EXPIRED'
                                    ? 'bg-rose-500/20 text-rose-300'
                                    : 'bg-amber-500/20 text-amber-300'
                            }`}
                        >
                            {activeOrder.status}
                        </span>
                    </div>

                    <div className='text-xs font-mono text-slate-300 space-y-1'>
                        <div>Order ID: {activeOrder.reservationId}</div>
                        <div>Buyer: {activeOrder.userId}</div>
                    </div>

                    {activeOrder.status === 'QUEUED' && (
                        <div className='flex items-center justify-between pt-2 border-t border-indigo-500/20'>
                            <div className='text-xs text-slate-300'>
                                Reaper Expires In:{' '}
                                <span className='font-mono font-bold text-amber-300'>
                                    {Math.floor(countdownSec / 60)}:
                                    {String(countdownSec % 60).padStart(2, '0')}
                                </span>
                            </div>
                            <button
                                onClick={handleConfirmPayment}
                                className='px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer'
                            >
                                <CheckCircle2 className='w-3.5 h-3.5' />
                                Confirm Payment
                            </button>
                        </div>
                    )}
                </div>
            )}
        </section>
    );
}

export default CustomerStoreFront;