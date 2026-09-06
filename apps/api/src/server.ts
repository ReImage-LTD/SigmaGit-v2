import { stopRunnerHealthWorker } from './workers/runner-health';
import { stopMigrationWorker } from './workers/migration';
import options from './index';
import { stopMemoryMonitoring } from './monitoring';

const server = Bun.serve(options);
let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  stopMemoryMonitoring();
  console.log('[API] Draining connections');
  const deadline = setTimeout(() => {
    void server.stop(true);
    process.exit(1);
  }, 25_000);
  try {
    await Promise.all([server.stop(false), stopRunnerHealthWorker(), stopMigrationWorker()]);
    clearTimeout(deadline);
    process.exit(0);
  } catch {
    process.exit(1);
  }
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
