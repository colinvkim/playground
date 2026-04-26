"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import {
  BookOpen,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Play,
  RotateCcw,
  Square,
  Sun,
  Trash2,
} from "lucide-react";
import PythonEditor from "@/components/python-editor";
import {
  lessonStarters,
  type LessonStarter,
  type PlaygroundLanguage,
} from "@/lib/playground-catalog";
import {
  INTERRUPT_SIGNAL,
  STDIN_CAPACITY_BYTES,
  type RuntimeStatus,
  type WorkerInboundMessage,
  type WorkerOutboundMessage,
} from "@/lib/runtime";
import {
  getPythonWorkerClient,
  resetPythonWorkerClient,
} from "@/lib/python-worker-client";
import { getStorageKey, persistCode, readStoredCode } from "@/lib/storage";

type PythonPlaygroundProps = {
  activeLanguage: PlaygroundLanguage;
  availableLanguages: PlaygroundLanguage[];
  defaultCode: string;
  lesson?: LessonStarter;
};

type MobilePanel = "code" | "output" | "guide";
type Theme = "light" | "dark";

const LEARN_ORIGIN = "https://learn.colinkim.dev";
const INTERACTIVE_WARNING =
  "Python can run, but input() and soft interrupts need cross-origin isolation in this browser.";
const textEncoder = new TextEncoder();

function normalizeTerminalText(text: string) {
  return text.replace(/\r?\n/g, "\r\n");
}

function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof window === "undefined") {
      return "light";
    }

    const stored = window.localStorage.getItem("learn-playground:theme");
    const preferredDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    return stored === "dark" || (!stored && preferredDark) ? "dark" : "light";
  });

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  function toggleTheme() {
    setTheme((current) => {
      const nextTheme = current === "dark" ? "light" : "dark";
      window.localStorage.setItem("learn-playground:theme", nextTheme);
      document.documentElement.classList.toggle("dark", nextTheme === "dark");
      return nextTheme;
    });
  }

  return { theme, toggleTheme };
}

export default function PythonPlayground({
  activeLanguage,
  availableLanguages,
  defaultCode,
  lesson,
}: PythonPlaygroundProps) {
  const [code, setCode] = useState(defaultCode);
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStatus>("standby");
  const [awaitingInput, setAwaitingInput] = useState(false);
  const [isIsolated, setIsIsolated] = useState(true);
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>("code");
  const [guideOpen, setGuideOpen] = useState(true);
  const { theme, toggleTheme } = useTheme();

  const storageKey = useMemo(
    () => getStorageKey(activeLanguage.id, lesson?.lessonSlug),
    [activeLanguage.id, lesson?.lessonSlug],
  );
  const pythonLessons = lessonStarters.filter((starter) => starter.languageId === "python");
  const isProgramActive =
    runtimeStatus === "loading" ||
    runtimeStatus === "running" ||
    runtimeStatus === "waiting-input";

  const codeRef = useRef(defaultCode);
  const persistTimeoutRef = useRef<number | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const stdinMetaRef = useRef<Int32Array | null>(null);
  const stdinBytesRef = useRef<Uint8Array | null>(null);
  const interruptBufferRef = useRef<Int32Array | null>(null);
  const activeRequestIdRef = useRef<string | null>(null);
  const requestSequenceRef = useRef(0);

  const terminalHostRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const currentInputRef = useRef("");
  const awaitingInputRef = useRef(false);
  const runtimeStatusRef = useRef<RuntimeStatus>("standby");
  const hasLoggedSupportErrorRef = useRef(false);

  const writeTerminal = useCallback((text: string) => {
    terminalRef.current?.write(normalizeTerminalText(text));
  }, []);

  const writelnTerminal = useCallback(
    (text: string) => {
      writeTerminal(`${text}\n`);
    },
    [writeTerminal],
  );

  const handleWorkerMessage = useCallback(
    (event: MessageEvent<WorkerOutboundMessage>) => {
      const message = event.data;

      if ("requestId" in message && message.requestId !== activeRequestIdRef.current) {
        return;
      }

      switch (message.type) {
        case "loading":
          setRuntimeStatus("loading");
          break;
        case "ready":
          setRuntimeStatus((current) => (current === "running" ? current : "ready"));
          break;
        case "execution_started":
          setRuntimeStatus("running");
          break;
        case "stdout":
        case "stderr":
          writeTerminal(message.chunk);
          break;
        case "input_request":
          currentInputRef.current = "";
          setAwaitingInput(true);
          setRuntimeStatus("waiting-input");
          terminalRef.current?.focus();
          setMobilePanel("output");
          break;
        case "success":
          setAwaitingInput(false);
          setRuntimeStatus("ready");
          activeRequestIdRef.current = null;
          break;
        case "interrupted":
          setAwaitingInput(false);
          currentInputRef.current = "";
          writelnTerminal("^C");
          setRuntimeStatus("stopped");
          activeRequestIdRef.current = null;
          break;
        case "error":
          setAwaitingInput(false);
          writelnTerminal(message.error);
          setRuntimeStatus("error");
          activeRequestIdRef.current = null;
          break;
      }
    },
    [writeTerminal, writelnTerminal],
  );

  const handleWorkerError = useCallback(
    (event: ErrorEvent) => {
      writelnTerminal(event.message);
      setRuntimeStatus("error");
      activeRequestIdRef.current = null;
    },
    [writelnTerminal],
  );

  const ensureWorker = useCallback(() => {
    if (workerRef.current) {
      return workerRef.current;
    }

    const workerClient = getPythonWorkerClient();
    const { worker } = workerClient;

    worker.addEventListener("message", handleWorkerMessage);
    worker.addEventListener("error", handleWorkerError);
    stdinMetaRef.current = workerClient.stdinMeta;
    stdinBytesRef.current = workerClient.stdinBytes;
    interruptBufferRef.current = workerClient.interruptBuffer;
    workerRef.current = worker;
    return worker;
  }, [handleWorkerError, handleWorkerMessage]);

  const resetTerminal = useCallback(() => {
    currentInputRef.current = "";
    terminalRef.current?.reset();
    fitAddonRef.current?.fit();
  }, []);

  const submitInput = useCallback(
    (input: string) => {
      const meta = stdinMetaRef.current;
      const bytes = stdinBytesRef.current;

      if (!meta || !bytes) {
        writelnTerminal("stdin channel is not ready.");
        return;
      }

      const encoded = textEncoder.encode(`${input}\n`);
      if (encoded.length > STDIN_CAPACITY_BYTES) {
        writelnTerminal(`stdin is too large. Limit input to ${STDIN_CAPACITY_BYTES - 1} bytes.`);
        return;
      }

      bytes.fill(0);
      bytes.set(encoded);
      Atomics.store(meta, 1, encoded.length);
      Atomics.store(meta, 0, 1);
      Atomics.notify(meta, 0, 1);
      setAwaitingInput(false);
      setRuntimeStatus("running");
    },
    [writelnTerminal],
  );

  const handleStop = useCallback(() => {
    const requestId = activeRequestIdRef.current;
    if (!requestId || !workerRef.current) {
      return;
    }

    if (runtimeStatusRef.current === "loading") {
      workerRef.current.removeEventListener("message", handleWorkerMessage);
      workerRef.current.removeEventListener("error", handleWorkerError);
      resetPythonWorkerClient();
      workerRef.current = null;
      stdinMetaRef.current = null;
      stdinBytesRef.current = null;
      interruptBufferRef.current = null;
      activeRequestIdRef.current = null;
      setRuntimeStatus("stopped");
      writelnTerminal("^C");
      return;
    }

    if (interruptBufferRef.current) {
      Atomics.store(interruptBufferRef.current, 0, INTERRUPT_SIGNAL);
      workerRef.current.postMessage({
        type: "stop",
        requestId,
      } satisfies WorkerInboundMessage);
      return;
    }

    workerRef.current.removeEventListener("message", handleWorkerMessage);
    workerRef.current.removeEventListener("error", handleWorkerError);
    resetPythonWorkerClient();
    workerRef.current = null;
    stdinMetaRef.current = null;
    stdinBytesRef.current = null;
    interruptBufferRef.current = null;
    activeRequestIdRef.current = null;
    setAwaitingInput(false);
    setRuntimeStatus("stopped");
    writelnTerminal("^C");
  }, [handleWorkerError, handleWorkerMessage, writelnTerminal]);

  const handleTerminalData = useCallback(
    (data: string) => {
      if (data.includes("\u0003")) {
        handleStop();
        return;
      }

      if (!awaitingInputRef.current) {
        return;
      }

      for (const char of Array.from(data)) {
        if (char === "\r" || char === "\n") {
          const input = currentInputRef.current;
          terminalRef.current?.write("\r\n");
          currentInputRef.current = "";
          submitInput(input);
          break;
        }

        if (char === "\u007f") {
          if (currentInputRef.current.length > 0) {
            currentInputRef.current = currentInputRef.current.slice(0, -1);
            terminalRef.current?.write("\b \b");
          }
          continue;
        }

        if (char === "\u0015") {
          while (currentInputRef.current.length > 0) {
            currentInputRef.current = currentInputRef.current.slice(0, -1);
            terminalRef.current?.write("\b \b");
          }
          continue;
        }

        if (char === "\u001b") {
          continue;
        }

        if (char === "\t" || char >= " ") {
          currentInputRef.current += char;
          terminalRef.current?.write(char);
        }
      }
    },
    [handleStop, submitInput],
  );

  useEffect(() => {
    const storedCode = readStoredCode(storageKey);
    const nextCode = storedCode || defaultCode;
    codeRef.current = nextCode;
    queueMicrotask(() => {
      setCode(nextCode);
    });

    const canUseSharedBuffers =
      typeof window !== "undefined" &&
      typeof window.SharedArrayBuffer !== "undefined" &&
      window.crossOriginIsolated;
    if (!canUseSharedBuffers) {
      queueMicrotask(() => {
        setIsIsolated(false);
        setRuntimeStatus("standby");
      });
    } else {
      queueMicrotask(() => {
        setIsIsolated(true);
        setRuntimeStatus("standby");
      });
    }
  }, [defaultCode, storageKey]);

  useEffect(() => {
    awaitingInputRef.current = awaitingInput;
    runtimeStatusRef.current = runtimeStatus;

    if (terminalRef.current) {
      terminalRef.current.options.cursorBlink = awaitingInput;
    }
  }, [awaitingInput, runtimeStatus]);

  useEffect(() => {
    if (!terminalHostRef.current || terminalRef.current) {
      return;
    }

    const terminal = new Terminal({
      allowTransparency: true,
      convertEol: false,
      cursorBlink: false,
      cursorStyle: "bar",
      cursorWidth: 2,
      fontFamily: '"JetBrains Mono", "SF Mono", monospace',
      fontSize: 14,
      fontWeight: "500",
      fontWeightBold: "700",
      lineHeight: 1.5,
      rightClickSelectsWord: true,
      scrollback: 3000,
      scrollSensitivity: 1.1,
      theme: {
        background: "#11182700",
        foreground: "#d5e6f7",
        cursor: "#8ce3b8",
        cursorAccent: "#02060d",
        brightBlack: "#475569",
        black: "#0f172a",
        red: "#f87171",
        green: "#8ce3b8",
        yellow: "#fbbf24",
        blue: "#56c7ff",
        magenta: "#c084fc",
        cyan: "#67e8f9",
        white: "#e2e8f0",
      },
    });
    const fitAddon = new FitAddon();

    terminal.loadAddon(fitAddon);
    terminal.open(terminalHostRef.current);
    terminal.textarea?.setAttribute("aria-label", "Python terminal");
    terminal.textarea?.setAttribute("autocapitalize", "off");
    terminal.textarea?.setAttribute("autocomplete", "off");
    terminal.textarea?.setAttribute("autocorrect", "off");
    terminal.textarea?.setAttribute("spellcheck", "false");
    fitAddon.fit();

    const disposable = terminal.onData(handleTerminalData);
    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    resizeObserverRef.current = new ResizeObserver(() => {
      fitAddon.fit();
    });
    resizeObserverRef.current.observe(terminalHostRef.current);

    return () => {
      disposable.dispose();
      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, [handleTerminalData]);

  useEffect(() => {
    if (isIsolated || hasLoggedSupportErrorRef.current || !terminalRef.current) {
      return;
    }

    hasLoggedSupportErrorRef.current = true;
    writelnTerminal(INTERACTIVE_WARNING);
  }, [isIsolated, writelnTerminal]);

  useEffect(() => {
    return () => {
      if (persistTimeoutRef.current !== null) {
        window.clearTimeout(persistTimeoutRef.current);
      }
      workerRef.current?.removeEventListener("message", handleWorkerMessage);
      workerRef.current?.removeEventListener("error", handleWorkerError);
      resetPythonWorkerClient();
      workerRef.current = null;
      stdinMetaRef.current = null;
      stdinBytesRef.current = null;
      interruptBufferRef.current = null;
    };
  }, [handleWorkerError, handleWorkerMessage]);

  function handleCodeChange(value: string) {
    codeRef.current = value;
    setCode(value);

    if (persistTimeoutRef.current !== null) {
      window.clearTimeout(persistTimeoutRef.current);
    }

    persistTimeoutRef.current = window.setTimeout(() => {
      persistCode(storageKey, value);
      persistTimeoutRef.current = null;
    }, 300);
  }

  function handleRun() {
    if (isProgramActive) {
      return;
    }

    const worker = ensureWorker();
    if (!worker) {
      return;
    }

    resetTerminal();
    const requestId = `python-${Date.now()}-${++requestSequenceRef.current}`;
    activeRequestIdRef.current = requestId;
    setRuntimeStatus("loading");
    setMobilePanel("output");

    worker.postMessage({
      type: "run",
      code: codeRef.current,
      requestId,
    } satisfies WorkerInboundMessage);
  }

  function handleClearOutput() {
    resetTerminal();
    terminalRef.current?.focus();
  }

  function handleResetCode() {
    codeRef.current = defaultCode;
    setCode(defaultCode);
    persistCode(storageKey, defaultCode);
  }

  return (
    <main className="grid h-dvh grid-rows-[auto_auto_1fr] overflow-hidden bg-canvas text-ink">
      <header className="flex h-14 items-center justify-between border-b border-line bg-panel px-3 sm:px-4">
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            className="focus-ring hidden size-9 items-center justify-center rounded-md border border-line text-muted transition hover:text-ink lg:inline-flex"
            onClick={() => setGuideOpen((current) => !current)}
            aria-label={guideOpen ? "Collapse lesson panel" : "Open lesson panel"}
          >
            {guideOpen ? <PanelLeftClose size={17} /> : <PanelLeftOpen size={17} />}
          </button>
          <Link
            href="/python"
            className="truncate text-sm font-semibold tracking-tight text-ink hover:text-accent"
          >
            playground
          </Link>
          <span className="hidden text-muted sm:inline">/</span>
          <select
            className="focus-ring rounded-md border border-line bg-panel-strong px-2 py-1 text-sm text-ink"
            value={activeLanguage.id}
            aria-label="Language"
            onChange={() => undefined}
          >
            {availableLanguages.map((language) => (
              <option
                key={language.id}
                value={language.id}
                disabled={language.status !== "ready"}
              >
                {language.label}
                {language.status === "planned" ? " (planned)" : ""}
              </option>
            ))}
          </select>
          {lesson ? (
            <a
              href={`${LEARN_ORIGIN}${lesson.learnPath}`}
              className="hidden truncate text-sm text-muted hover:text-accent md:block"
            >
              {lesson.title}
            </a>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            className="focus-ring inline-flex h-9 items-center gap-2 rounded-md border border-line bg-panel-strong px-3 text-sm font-medium text-ink transition hover:border-accent/50 disabled:opacity-50"
            onClick={isProgramActive ? handleStop : handleRun}
            disabled={false}
          >
            {isProgramActive ? <Square size={15} /> : <Play size={15} />}
            <span>{isProgramActive ? "Stop" : "Run"}</span>
          </button>
          <button
            type="button"
            className="focus-ring hidden size-9 items-center justify-center rounded-md border border-line bg-panel-strong text-muted transition hover:text-ink sm:inline-flex"
            onClick={handleResetCode}
            aria-label="Reset code"
            title="Reset code"
          >
            <RotateCcw size={16} />
          </button>
          <button
            type="button"
            className="focus-ring size-9 rounded-md border border-line bg-panel-strong text-muted transition hover:text-ink"
            onClick={toggleTheme}
            aria-label="Toggle theme"
            title="Toggle theme"
          >
            <span className="flex h-full items-center justify-center">
              {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
            </span>
          </button>
        </div>
      </header>

      <div className="grid grid-cols-3 border-b border-line bg-panel px-2 py-2 text-sm md:hidden">
        {(["code", "output", "guide"] as const).map((panel) => (
          <button
            key={panel}
            type="button"
            className={`focus-ring rounded-md px-3 py-2 capitalize ${
              mobilePanel === panel
                ? "bg-accent-soft text-ink"
                : "text-muted hover:text-ink"
            }`}
            onClick={() => setMobilePanel(panel)}
          >
            {panel}
          </button>
        ))}
      </div>

      <section
        className={`grid min-h-0 grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(320px,0.52fr)] ${
          guideOpen ? "lg:grid-cols-[260px_minmax(0,1fr)_minmax(340px,0.52fr)]" : ""
        }`}
      >
        <aside
          className={`min-h-0 overflow-auto border-r border-line bg-panel px-3 py-4 md:hidden lg:block ${
            guideOpen ? "" : "lg:hidden"
          } ${mobilePanel === "guide" ? "block" : "hidden"}`}
        >
          <div className="mb-4 flex items-center gap-2 text-sm font-semibold">
            <BookOpen size={16} />
            Learn starters
          </div>
          <div className="space-y-1">
            <Link
              href="/python"
              className={`block rounded-md px-3 py-2 text-sm transition ${
                !lesson ? "bg-accent-soft text-ink" : "text-muted hover:bg-panel-strong hover:text-ink"
              }`}
            >
              Scratch
            </Link>
            {pythonLessons.map((starter) => (
              <Link
                key={starter.lessonSlug}
                href={`/python?lesson=${starter.lessonSlug}`}
                className={`block rounded-md px-3 py-2 text-sm transition ${
                  lesson?.lessonSlug === starter.lessonSlug
                    ? "bg-accent-soft text-ink"
                    : "text-muted hover:bg-panel-strong hover:text-ink"
                }`}
              >
                {starter.title}
              </Link>
            ))}
          </div>
        </aside>

        <section
          className={`min-h-0 overflow-hidden border-line bg-code-panel md:block ${
            mobilePanel === "code" ? "block" : "hidden"
          }`}
        >
          <PythonEditor code={code} onCodeChange={handleCodeChange} />
        </section>

        <section
          className={`grid min-h-0 grid-rows-[auto_1fr] border-l border-line bg-code md:block ${
            mobilePanel === "output" ? "block" : "hidden"
          }`}
        >
          <div className="flex h-11 items-center justify-between border-b border-white/10 bg-black/10 px-3">
            <div className="flex items-center gap-2">
              <span className="code-font text-xs font-medium uppercase tracking-wide text-slate-300">
                Output
              </span>
              {awaitingInput ? (
                <span className="rounded-sm bg-accent/20 px-2 py-0.5 text-xs text-accent">
                  input requested
                </span>
              ) : null}
              {!isIsolated ? (
                <span className="hidden rounded-sm bg-white/10 px-2 py-0.5 text-xs text-slate-300 sm:inline">
                  basic runtime
                </span>
              ) : null}
            </div>
            <button
              type="button"
              className="focus-ring inline-flex size-8 items-center justify-center rounded-md text-slate-400 transition hover:bg-white/10 hover:text-slate-100"
              onClick={handleClearOutput}
              aria-label="Clear output"
              title="Clear output"
            >
              <Trash2 size={15} />
            </button>
          </div>
          <div ref={terminalHostRef} className="terminal-host min-h-0 p-3" />
        </section>
      </section>
    </main>
  );
}
