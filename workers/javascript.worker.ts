import {
  getQuickJS,
  type QuickJSContext,
  type QuickJSHandle,
  type QuickJSRuntime,
  type QuickJSWASMModule,
} from "quickjs-emscripten";
import * as ts from "typescript";
import {
  INTERRUPT_SIGNAL,
  type RunnableLanguageId,
  type WorkerInboundMessage,
  type WorkerOutboundMessage,
} from "@/lib/runtime";

const decoder = new TextDecoder();
let quickJSReadyPromise: Promise<QuickJSWASMModule> | null = null;
let stdinMeta: Int32Array | null = null;
let stdinBytes: Uint8Array | null = null;
let interruptBuffer: Int32Array | null = null;
let activeRequestId: string | null = null;

function post(message: WorkerOutboundMessage) {
  self.postMessage(message);
}

function postStream(type: "stdout" | "stderr", chunk: string) {
  const requestId = activeRequestId;

  if (!requestId || chunk.length === 0) {
    return;
  }

  post({
    type,
    chunk,
    requestId,
  });
}

function shouldStop() {
  return interruptBuffer
    ? Atomics.load(interruptBuffer, 0) === INTERRUPT_SIGNAL
    : false;
}

function ensureStdinReady() {
  if (!stdinMeta || !stdinBytes) {
    throw new Error(
      "prompt() is unavailable because this browser session is not cross-origin isolated.",
    );
  }

  return {
    meta: stdinMeta,
    bytes: stdinBytes,
  };
}

function readPromptInput() {
  const { meta, bytes } = ensureStdinReady();
  const requestId = activeRequestId;

  if (!requestId) {
    throw new Error("No active request for prompt().");
  }

  post({
    type: "input_request",
    requestId,
  });

  while (Atomics.load(meta, 0) === 0) {
    if (shouldStop()) {
      throw new Error("interrupted");
    }

    Atomics.wait(meta, 0, 0, 100);
  }

  const length = Atomics.load(meta, 1);
  const next = bytes.slice(0, length);
  Atomics.store(meta, 0, 0);
  Atomics.store(meta, 1, 0);
  return decoder.decode(next).replace(/\r?\n$/, "");
}

async function ensureQuickJS(options?: { silent?: boolean }) {
  const silent = options?.silent ?? false;

  if (!quickJSReadyPromise) {
    if (!silent) {
      post({ type: "loading" });
    }

    quickJSReadyPromise = getQuickJS()
      .then((instance) => {
        if (!silent) {
          post({ type: "ready" });
        }
        return instance;
      })
      .catch((error) => {
        quickJSReadyPromise = null;
        throw error;
      });
  }

  return quickJSReadyPromise;
}

function formatConsoleValue(value: unknown) {
  if (typeof value === "string") {
    return value;
  }

  if (
    value === null ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint" ||
    typeof value === "undefined"
  ) {
    return String(value);
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function formatDiagnostic(diagnostic: ts.Diagnostic) {
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
  const code = `TS${diagnostic.code}`;

  if (diagnostic.file && typeof diagnostic.start === "number") {
    const position = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
    return `${diagnostic.file.fileName}:${position.line + 1}:${
      position.character + 1
    } - ${code}: ${message}`;
  }

  return `${code}: ${message}`;
}

function transpileTypeScript(code: string) {
  const output = ts.transpileModule(code, {
    fileName: "editor.ts",
    reportDiagnostics: true,
    compilerOptions: {
      module: ts.ModuleKind.None,
      target: ts.ScriptTarget.ES2020,
      strict: true,
      sourceMap: false,
    },
  });
  const diagnostics =
    output.diagnostics?.filter(
      (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
    ) ?? [];

  if (diagnostics.length > 0) {
    throw new Error(diagnostics.map(formatDiagnostic).join("\n"));
  }

  return output.outputText;
}

function setHostFunction(
  vm: QuickJSContext,
  target: QuickJSHandle,
  name: string,
  fn: (...args: QuickJSHandle[]) => QuickJSHandle,
) {
  const handle = vm.newFunction(name, fn);
  vm.setProp(target, name, handle);
  handle.dispose();
}

function installConsole(vm: QuickJSContext) {
  const consoleHandle = vm.newObject();

  for (const [method, stream] of [
    ["log", "stdout"],
    ["info", "stdout"],
    ["warn", "stderr"],
    ["error", "stderr"],
  ] as const) {
    setHostFunction(vm, consoleHandle, method, (...args) => {
      const text = args.map((arg) => formatConsoleValue(vm.dump(arg))).join(" ");
      postStream(stream, `${text}\n`);
      return vm.undefined;
    });
  }

  vm.setProp(vm.global, "console", consoleHandle);
  consoleHandle.dispose();
}

function installPrompt(vm: QuickJSContext) {
  setHostFunction(vm, vm.global, "prompt", (messageHandle) => {
    if (messageHandle) {
      const message = formatConsoleValue(vm.dump(messageHandle));
      if (message) {
        postStream("stdout", message);
      }
    }

    return vm.newString(readPromptInput());
  });
}

function installHostAPIs(vm: QuickJSContext) {
  installConsole(vm);
  installPrompt(vm);
}

function executePendingJobs(runtime: QuickJSRuntime, vm: QuickJSContext) {
  while (runtime.hasPendingJob()) {
    const result = runtime.executePendingJobs(1000);

    if ("error" in result) {
      vm.unwrapResult(result);
    }
  }
}

async function runCode(
  code: string,
  requestId: string,
  language: RunnableLanguageId,
) {
  activeRequestId = requestId;
  if (interruptBuffer) {
    Atomics.store(interruptBuffer, 0, 0);
  }

  let runtime: QuickJSRuntime | null = null;
  let vm: QuickJSContext | null = null;

  try {
    const quickJS = await ensureQuickJS();
    post({
      type: "execution_started",
      requestId,
    });

    const source =
      language === "typescript" ? transpileTypeScript(code) : code;

    runtime = quickJS.newRuntime();
    runtime.setMemoryLimit(16 * 1024 * 1024);
    runtime.setMaxStackSize(1024 * 1024);
    runtime.setInterruptHandler(() => shouldStop());

    vm = runtime.newContext();
    installHostAPIs(vm);

    const result = vm.evalCode(source, language === "typescript" ? "editor.ts" : "editor.js", {
      type: "global",
    });
    const handle = vm.unwrapResult(result);
    handle.dispose();
    executePendingJobs(runtime, vm);

    post({
      type: shouldStop() ? "interrupted" : "success",
      requestId,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unknown JavaScript runtime error.";

    if (shouldStop()) {
      post({
        type: "interrupted",
        requestId,
      });
    } else {
      post({
        type: "error",
        requestId,
        error: message,
      });
    }
  } finally {
    vm?.dispose();
    runtime?.dispose();
    activeRequestId = null;
    if (interruptBuffer) {
      Atomics.store(interruptBuffer, 0, 0);
    }
  }
}

self.onmessage = (event: MessageEvent<WorkerInboundMessage>) => {
  const message = event.data;

  if (message.type === "init") {
    if (message.stdinBuffer) {
      stdinMeta = new Int32Array(message.stdinBuffer, 0, 2);
      stdinBytes = new Uint8Array(message.stdinBuffer, 8);
    }

    if (message.interruptBuffer) {
      interruptBuffer = new Int32Array(message.interruptBuffer);
    }
    return;
  }

  if (message.type === "warm") {
    void ensureQuickJS({ silent: true });
    return;
  }

  if (message.type === "run") {
    void runCode(message.code, message.requestId, message.language ?? "javascript");
    return;
  }

  if (message.type === "stop" && activeRequestId === message.requestId && interruptBuffer) {
    Atomics.store(interruptBuffer, 0, INTERRUPT_SIGNAL);
  }
};
