import type { AxiosInstance } from 'axios';
import type { Dispatch, SetStateAction } from 'react';

import type { ActiveCustomer } from './ActiveCustomer';

type CustomerStoreFrontProps = {
    setUserId: Dispatch<SetStateAction<string>>,
    setIdempotencyKey: Dispatch<SetStateAction<string>>,
    userId: string,
    idempotencyKey: string,
    mode: 'ATOMIC' | 'NAIVE',
    activeOrder: ActiveCustomer | null,
    appendLog: (msg: string) => void,
    edgeApi: AxiosInstance,
    setActiveOrder: Dispatch<SetStateAction<ActiveCustomer | null>>,
    ledgerApi: AxiosInstance,
    countdownSec: number
}

export type { CustomerStoreFrontProps }