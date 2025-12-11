import { type TxHash, TxProfileResult } from "@aztec/aztec.js/tx";
import type { ProfileOptions } from "@aztec/aztec.js/wallet";
import type { LogLevel } from "@aztec/foundation/log";

export type ProfileableInteraction = {
    profile(opts: ProfileOptions): Promise<TxProfileResult>;
}

export const LOG_LEVELS: readonly LogLevel[] = [
    'silent',
    'fatal',
    'error',
    'warn',
    'info',
    'verbose',
    'debug',
    'trace'
];

export const GATE_TYPES = [
    'ecc_op',
    'busread',
    'lookup',
    'pub_inputs',
    'arithmetic',
    'delta_range',
    'elliptic',
    'aux',
    'poseidon2_external',
    'poseidon2_internal',
    'overflow',
] as const;

export type GateType = (typeof GATE_TYPES)[number];

export type LogEntry = {
    type: LogLevel;
    prefix: string;
    message: string;
    data: unknown;
    timestamp: number;
}

export type OracleStats = {
    calls: number;
    max: number;
    min: number;
    total: number;
    avg: number;
}

export type BenchmarkStep = {
    functionName: string;
    gateCount: number | undefined;
    accGateCount: number;
    time: number;
    oracles: Record<string, OracleStats>;
}

export type Benchmark = {
    name: string;
    timings: {
        total: number;
        sync: number | undefined;
        proving: number | undefined;
        unaccounted: number;
        witgen: number;
    };
    rpc: Record<string, OracleStats>;
    maxMemory: number;
    proverType: string;
    minimumTrace: Record<GateType, number> | undefined;
    totalGateCount: number;
    steps: BenchmarkStep[];
    error: unknown;
}

export type VAAVerificationResult = {
    txHash: TxHash;
    vaaLength: number;
};