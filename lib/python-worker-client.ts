"use client";

import { STDIN_CAPACITY_BYTES, type WorkerInboundMessage } from "@/lib/runtime";

type PythonWorkerClient = {
  interruptBuffer: Int32Array | null;
  stdinBytes: Uint8Array | null;
  stdinMeta: Int32Array | null;
  worker: Worker;
};

let client: PythonWorkerClient | null = null;
let warmRequested = false;

export function getPythonWorkerClient() {
  if (client) {
    return client;
  }

  const worker = new Worker(new URL("../workers/python.worker.ts", import.meta.url), {
    type: "module",
  });

  const canUseSharedBuffers =
    typeof SharedArrayBuffer !== "undefined" && window.crossOriginIsolated;
  const stdinBuffer = canUseSharedBuffers
    ? new SharedArrayBuffer(8 + STDIN_CAPACITY_BYTES)
    : undefined;
  const interruptArrayBuffer = canUseSharedBuffers ? new SharedArrayBuffer(4) : undefined;

  const stdinMeta = stdinBuffer ? new Int32Array(stdinBuffer, 0, 2) : null;
  const stdinBytes = stdinBuffer ? new Uint8Array(stdinBuffer, 8) : null;
  const interruptBuffer = interruptArrayBuffer ? new Int32Array(interruptArrayBuffer) : null;

  worker.postMessage({
    type: "init",
    stdinBuffer,
    interruptBuffer: interruptArrayBuffer,
  } satisfies WorkerInboundMessage);

  client = {
    interruptBuffer,
    stdinBytes,
    stdinMeta,
    worker,
  };

  return client;
}

export function warmPythonWorker() {
  const nextClient = getPythonWorkerClient();

  if (warmRequested) {
    return nextClient;
  }

  warmRequested = true;
  nextClient.worker.postMessage({ type: "warm" } satisfies WorkerInboundMessage);
  return nextClient;
}

export function resetPythonWorkerClient() {
  client?.worker.terminate();
  client = null;
  warmRequested = false;
}
