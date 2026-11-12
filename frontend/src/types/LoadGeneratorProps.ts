import type { AxiosInstance } from 'axios';

type LoadGeneratorProps = {
    mode: 'ATOMIC' | 'NAIVE',
    appendLog: (msg:string) => void,
    edgeApi: AxiosInstance,
    actionLogs: string[]
}

export type { LoadGeneratorProps }