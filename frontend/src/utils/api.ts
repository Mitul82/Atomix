import axios from 'axios';

export const EDGE_URL = import.meta.env.VITE_EDGE_URL || 'http://localhost:3000/api/v1';
export const LEDGER_URL = import.meta.env.VITE_LEDGER_URL || 'http://localhost:3001/api/v1/ledger';

export const edgeApi = axios.create({
    baseURL: EDGE_URL,
    timeout: 3000,
    headers: { 'Content-Type': 'application/json' }
});

export const ledgerApi = axios.create({
    baseURL: LEDGER_URL,
    timeout: 3000,
    headers: { 'Content-Type': 'application/json' }
});