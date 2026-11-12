import type { AxiosInstance } from 'axios';
import type { Dispatch, SetStateAction } from 'react';

import type { ActiveCustomer } from './ActiveCustomer';

type NavbarProps = {
    ledgerApi: AxiosInstance,
    setActiveOrder: Dispatch<SetStateAction<ActiveCustomer | null>>,
    setUserId: Dispatch<SetStateAction<string>>,
    setIdempotencyKey: Dispatch<SetStateAction<string>>,
    appendLog: (msg: string) => void,
    refreshLedger: () => Promise<void>,
    setMode: Dispatch<SetStateAction<'ATOMIC' | 'NAIVE'>>,
    mode: 'ATOMIC' | 'NAIVE'
}

export type { NavbarProps }