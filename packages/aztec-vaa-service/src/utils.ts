import assert from 'node:assert';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type LogLevel, type Logger, createLogger } from '@aztec/foundation/log';
import { type PrivateExecutionStep, serializePrivateExecutionSteps } from '@aztec/stdlib/kernel';
import type { ProvingStats, TxProfileResult } from '@aztec/stdlib/tx';
import type { ProfileOptions } from '@aztec/aztec.js/wallet';
import {
    type Benchmark,
    type BenchmarkStep,
    GATE_TYPES,
    type GateType,
    LOG_LEVELS,
    type LogEntry,
    type OracleStats,
    type ProfileableInteraction
} from './types.js';

const logger = createLogger('bench:profile_capture');

export default class ProxyLogger {
    static instance: ProxyLogger;
    logs: LogEntry[] = [];

    constructor() { }

    static create(): void {
        ProxyLogger.instance = new ProxyLogger();
    }

    static getInstance(): ProxyLogger {
        return ProxyLogger.instance;
    }

    createLogger(prefix: string): Logger {
        return new Proxy(createLogger(prefix), {
            get: (target: Logger, prop: string | symbol): unknown => {
                if (typeof prop === 'string' && LOG_LEVELS.includes(prop as LogLevel)) {
                    return (...data: [string, unknown?]): void => {
                        const loggingFn = prop as LogLevel;
                        ProxyLogger.getInstance().handleLog(loggingFn, prefix, data[0], data[1]);
                        (target[loggingFn] as (msg: string, data?: unknown) => void)(data[0], data[1]);
                    };
                } else {
                    return target[prop as keyof Logger];
                }
            },
        });
    }

    handleLog(type: LogLevel, prefix: string, message: string, data: unknown): void {
        this.logs.unshift({ type, prefix, message, data, timestamp: Date.now() });
    }

    flushLogs(): void {
        this.logs = [];
    }

    getLogs(): LogEntry[] {
        return this.logs;
    }
}

function getMinimumTrace(logs: LogEntry[]): Record<GateType, number> {
    const minimumMessage = 'Minimum required block sizes for structured trace';
    const minimumMessageIndex = logs.findIndex(log => log.message.includes(minimumMessage));
    const candidateLogs = logs.slice(minimumMessageIndex - GATE_TYPES.length, minimumMessageIndex + 5);

    const traceLogs = candidateLogs
        .filter(log => GATE_TYPES.some(type => log.message.includes(type)))
        .map(log => log.message.split(/\t|\n/))
        .flat()
        .map(log => log.replace(/\(mem: .*\)/, '').trim())
        .filter(Boolean);

    const traceSizes: Partial<Record<GateType, number>>[] = traceLogs.map(log => {
        const [gateType, gateSizeStr] = log
            .replace(/\n.*\)$/, '')
            .replace(/bb - /, '')
            .split(':')
            .map(s => s.trim());
        const gateSize = parseInt(gateSizeStr);
        assert(GATE_TYPES.includes(gateType as GateType), `Gate type ${gateType} is not recognized`);
        return { [gateType]: gateSize } as Partial<Record<GateType, number>>;
    });

    assert(traceSizes.length === GATE_TYPES.length, 'Decoded trace sizes do not match expected amount of gate types');
    const result = traceSizes.reduce<Partial<Record<GateType, number>>>((acc, curr) => ({ ...acc, ...curr }), {});
    return result as Record<GateType, number>;
}

function getMaxMemory(logs: LogEntry[]): number {
    const candidateLogs = logs.slice(0, 100).filter(log => /\(mem: .*MiB\)/.test(log.message));
    const usage = candidateLogs.map(log => {
        const memStr = log ? log.message.slice(log.message.indexOf('(mem: ') + 6, log.message.indexOf('MiB') - 3) : '';
        return memStr ? parseInt(memStr) : 0;
    });
    return Math.max(...usage);
}

export function generateBenchmark(
    flow: string,
    logs: LogEntry[],
    stats: ProvingStats,
    privateExecutionSteps: PrivateExecutionStep[],
    proverType: string,
    error: unknown,
): Benchmark {
    let maxMemory = 0;
    let minimumTrace: Record<GateType, number> | undefined;
    try {
        minimumTrace = getMinimumTrace(logs);
        maxMemory = getMaxMemory(logs);
    } catch {
        logger.warn(`Failed obtain minimum trace and max memory for ${flow}. Did you run with REAL_PROOFS=1?`);
    }

    const steps = privateExecutionSteps.reduce<BenchmarkStep[]>((acc, step, i) => {
        const previousAccGateCount = i === 0 ? 0 : acc[i - 1].accGateCount;
        return [
            ...acc,
            {
                functionName: step.functionName,
                gateCount: step.gateCount,
                accGateCount: previousAccGateCount + (step.gateCount ?? 0),
                time: step.timings.witgen,
                oracles: Object.entries(step.timings.oracles ?? {}).reduce<Record<string, OracleStats>>(
                    (acc, [oracleName, oracleData]) => {
                        const total = oracleData.times.reduce((sum, time) => sum + time, 0);
                        const calls = oracleData.times.length;
                        acc[oracleName] = {
                            calls,
                            max: Math.max(...oracleData.times),
                            min: Math.min(...oracleData.times),
                            total,
                            avg: total / calls,
                        };
                        return acc;
                    },
                    {},
                ),
            },
        ];
    }, []);
    const timings = stats.timings;
    const totalGateCount = steps.length > 0 ? steps[steps.length - 1].accGateCount : 0;
    return {
        name: flow,
        timings: {
            total: timings.total,
            sync: timings.sync,
            proving: timings.proving,
            unaccounted: timings.unaccounted,
            witgen: timings.perFunction.reduce((acc, fn) => acc + fn.time, 0),
        },
        rpc: Object.entries(stats.nodeRPCCalls ?? {}).reduce<Record<string, OracleStats>>(
            (acc, [RPCName, RPCCalls]) => {
                const total = RPCCalls.times.reduce((sum, time) => sum + time, 0);
                const calls = RPCCalls.times.length;
                acc[RPCName] = {
                    calls,
                    max: Math.max(...RPCCalls.times),
                    min: Math.min(...RPCCalls.times),
                    total,
                    avg: total / calls,
                };
                return acc;
            },
            {},
        ),
        maxMemory,
        proverType,
        minimumTrace,
        totalGateCount,
        steps,
        error,
    };
}

export async function captureProfile(
    label: string,
    interaction: ProfileableInteraction,
    opts: ProfileOptions,
    expectedSteps?: number,
): Promise<TxProfileResult> {
    // Make sure the proxy logger starts from a clean slate
    ProxyLogger.getInstance().flushLogs();
    const result = await interaction.profile({ ...opts, profileMode: 'full', skipProofGeneration: true });
    const logs = ProxyLogger.getInstance().getLogs();
    if (expectedSteps !== undefined && result.executionSteps.length !== expectedSteps) {
        throw new Error(`Expected ${expectedSteps} execution steps, got ${result.executionSteps.length}`);
    }
    const benchmark = generateBenchmark(label, logs, result.stats, result.executionSteps, 'wasm', undefined);

    const ivcFolder = process.env.CAPTURE_IVC_FOLDER;
    if (ivcFolder) {
        logger.info(`Capturing client ivc execution profile for ${label}`);

        const resultsDirectory = join(ivcFolder, label);
        logger.info(`Writing private execution steps to ${resultsDirectory}`);
        await mkdir(resultsDirectory, { recursive: true });
        // Write the client IVC files read by the prover.
        const ivcInputsPath = join(resultsDirectory, 'ivc-inputs.msgpack');
        await writeFile(ivcInputsPath, serializePrivateExecutionSteps(result.executionSteps));
        await writeFile(join(resultsDirectory, 'logs.json'), JSON.stringify(logs, null, 2));
        await writeFile(join(resultsDirectory, 'benchmark.json'), JSON.stringify(benchmark, null, 2));
        logger.info(`Wrote private execution steps to ${resultsDirectory}`);
    }

    return result;
}
