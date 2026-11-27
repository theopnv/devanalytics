import { createWorker } from '../core/worker/router.ts';
import { workerRegistry } from './generated/worker-registry.ts';

export default createWorker(workerRegistry);
