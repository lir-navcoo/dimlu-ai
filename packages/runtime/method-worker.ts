import {
  handleWorkerMessage,
  type HostToWorkerMessage,
  type WorkerRunState,
  type WorkerToHostMessage,
} from './method-worker-core';

/** Thin entry for the dedicated method realm; all logic lives in method-worker-core. */
const scope = self as unknown as {
  onmessage: ((event: { data: HostToWorkerMessage }) => void) | null;
  postMessage: (message: WorkerToHostMessage) => void;
};

const runs: WorkerRunState = new Map();
const post = (message: WorkerToHostMessage) => scope.postMessage(message);

scope.onmessage = (event) => handleWorkerMessage(event.data, post, runs);
