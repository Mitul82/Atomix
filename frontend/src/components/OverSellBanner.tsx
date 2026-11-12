import { AlertTriangle, ShieldCheck } from 'lucide-react';

import useTelemetry from '@/hooks/useTelemetry';

function OverSellBanner() {
    const { ledgerMetrics } = useTelemetry('1');
    
    const isOversold = ledgerMetrics.oversoldDiscrepancy > 0 || ledgerMetrics.postgresAvailableInventory < 0;
    const oversoldAmount = Math.max(
        ledgerMetrics.oversoldDiscrepancy,
        ledgerMetrics.postgresAvailableInventory < 0 ? Math.abs(ledgerMetrics.postgresAvailableInventory) : 0
    );

    return (
        <div className={`rounded-xl p-4 border flex items-center justify-between transition-all ${isOversold ? 'bg-rose-950/60 border-rose-500/60 text-rose-200 shadow-lg shadow-rose-950/50' : 'bg-emerald-950/30 border-emerald-500/30 text-emerald-200'}`}>
            <div className='flex items-center gap-3'>
                {isOversold ? (
                    <AlertTriangle className='w-7 h-7 text-rose-400 shrink-0 animate-bounce' />
                ) : (
                    <ShieldCheck className='w-7 h-7 text-emerald-400 shrink-0' />
                )}
                <div>
                    <h2 className='text-sm font-bold uppercase tracking-wider'>
                        {isOversold
                            ? `CRITICAL RACE CONDITION DETECTED: OVERSOLD BY +${oversoldAmount} UNITS!`
                            : 'INVARIANT HEALTHY: ZERO OVERSELLING DETECTED'}
                    </h2>
                    <p className='text-xs opacity-80 mt-0.5'>
                        {isOversold
                            ? 'Naive SQL SELECT-then-UPDATE allowed concurrent threads to read stale inventory before transactions committed.'
                            : 'Single-threaded Redis Lua gatekeeper & RabbitMQ backpressure are maintaining strict inventory consistency.'}
                    </p>
                </div>
            </div>
            <div className='text-right font-mono'>
                <span className='text-xs uppercase block opacity-70'>Discrepancy</span>
                <span className={`text-2xl font-black ${isOversold ? 'text-rose-400' : 'text-emerald-400'}`}>
                    {isOversold ? `+${oversoldAmount}` : '0'}
                </span>
            </div>
        </div>
    );
}

export default OverSellBanner;