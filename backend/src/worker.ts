import path from 'path';
import { startBackgroundWorkers } from './services/backgroundWorkers';
import { startCollisionMonitoringWorker } from './services/collisionMonitoringWorker';

if (typeof (process as any).loadEnvFile === 'function') {
    try {
        (process as any).loadEnvFile(path.resolve(process.cwd(), '.env'));
    } catch (_) {
    }
}

async function startWorkerRuntime() {
    await startBackgroundWorkers();
    await startCollisionMonitoringWorker();
    process.stdout.write('[worker] Background workers started\n');
}

startWorkerRuntime().catch((error) => {
    process.stderr.write(`[worker] Fatal startup error: ${String(error?.message || error)}\n`);
    process.exit(1);
});

process.on('SIGTERM', () => {
    process.stdout.write('[worker] SIGTERM received, shutting down\n');
    process.exit(0);
});

process.on('SIGINT', () => {
    process.stdout.write('[worker] SIGINT received, shutting down\n');
    process.exit(0);
});

