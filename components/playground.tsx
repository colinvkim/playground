"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  Clock3,
  Code2,
  FileCode2,
  LoaderCircle,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Play,
  RotateCcw,
  Save,
  ShieldCheck,
  Square,
  Sun,
  TerminalSquare,
  Trash2,
} from "lucide-react";
import CodeEditor from "@/components/code-editor";
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
  warmPythonWorker,
} from "@/lib/python-worker-client";
import {
  getJavaScriptWorkerClient,
  resetJavaScriptWorkerClient,
  warmJavaScriptWorker,
} from "@/lib/javascript-worker-client";
import { getStorageKey, persistCode, readStoredCode } from "@/lib/storage";

type PlaygroundProps = {
  activeLanguage: PlaygroundLanguage;
  availableLanguages: PlaygroundLanguage[];
  defaultCode: string;
  lesson?: LessonStarter;
};

type MobilePanel = "code" | "output" | "guide";
type Theme = "light" | "dark";
type SaveStatus = "saved" | "saving" | "blocked";
type LastRunOutcome = "success" | "error" | "stopped";
type StatusTone = "neutral" | "accent" | "success" | "warning" | "danger";

type LastRun = {
  durationMs: number;
  outcome: LastRunOutcome;
};

const LEARN_ORIGIN = "https://learn.colinkim.dev";
const INTERACTIVE_WARNINGS: Record<"pyodide" | "quickjs", string> = {
  pyodide:
    "Python can run, but input() and soft interrupts need cross-origin isolation in this browser.",
  quickjs:
    "JavaScript and TypeScript can run, but prompt() and soft interrupts need cross-origin isolation in this browser.",
};
const MAX_TERMINAL_TRANSCRIPT_CHARS = 20000;
const textEncoder = new TextEncoder();
const numberFormatter = new Intl.NumberFormat("en-US");

const runtimeStatusMeta: Record<
  RuntimeStatus,
  { label: string; tone: StatusTone }
> = {
  standby: { label: "Standby", tone: "neutral" },
  loading: { label: "Loading runtime", tone: "accent" },
  ready: { label: "Ready", tone: "success" },
  running: { label: "Running", tone: "accent" },
  "waiting-input": { label: "Waiting for input", tone: "warning" },
  stopped: { label: "Stopped", tone: "neutral" },
  error: { label: "Error", tone: "danger" },
};

const saveStatusMeta: Record<SaveStatus, { label: string; tone: StatusTone }> = {
  saved: { label: "Saved", tone: "success" },
  saving: { label: "Saving", tone: "accent" },
  blocked: { label: "Local save blocked", tone: "warning" },
};

const mobilePanels: { id: MobilePanel; label: string }[] = [
  { id: "code", label: "Code" },
  { id: "output", label: "Output" },
  { id: "guide", label: "Guide" },
];

function normalizeTerminalText(text: string) {
  return text.replace(/\r?\n/g, "\r\n");
}

function appendTerminalTranscript(current: string, text: string) {
  const plainText = text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");

  if (!plainText) {
    return current;
  }

  const nextTranscript = `${current}${plainText}`;
  return nextTranscript.length > MAX_TERMINAL_TRANSCRIPT_CHARS
    ? nextTranscript.slice(-MAX_TERMINAL_TRANSCRIPT_CHARS)
    : nextTranscript;
}

function formatDuration(milliseconds: number) {
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) {
    return "0ms";
  }

  if (milliseconds < 1000) {
    return `${Math.round(milliseconds)}ms`;
  }

  if (milliseconds < 10000) {
    return `${(milliseconds / 1000).toFixed(1)}s`;
  }

  return `${Math.round(milliseconds / 1000)}s`;
}

function getCodeStats(code: string) {
  const normalizedCode = code.replace(/\r\n/g, "\n");
  const lines = normalizedCode.length === 0 ? 1 : normalizedCode.split("\n").length;

  return {
    characters: code.length,
    lines,
  };
}

function getPillClass(tone: StatusTone) {
  switch (tone) {
    case "accent":
      return "border-accent/30 bg-accent/10 text-accent";
    case "success":
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200";
    case "warning":
      return "border-amber-500/35 bg-amber-500/10 text-amber-700 dark:text-amber-200";
    case "danger":
      return "border-danger/35 bg-danger/10 text-danger";
    case "neutral":
    default:
      return "border-line bg-panel-strong text-muted";
  }
}

function getDotClass(tone: StatusTone) {
  switch (tone) {
    case "accent":
      return "bg-accent";
    case "success":
      return "bg-emerald-500";
    case "warning":
      return "bg-amber-500";
    case "danger":
      return "bg-danger";
    case "neutral":
    default:
      return "bg-muted";
  }
}

function readInitialTheme(): Theme {
  if (typeof window === "undefined") {
    return "light";
  }

  let stored: string | null = null;

  try {
    stored = window.localStorage.getItem("learn-playground:theme");
  } catch {
    stored = null;
  }

  const preferredDark =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches;

  return stored === "dark" || (!stored && preferredDark) ? "dark" : "light";
}

function useTheme() {
  const [theme, setTheme] = useState<Theme>(readInitialTheme);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  function toggleTheme() {
    setTheme((current) => {
      const nextTheme = current === "dark" ? "light" : "dark";

      try {
        window.localStorage.setItem("learn-playground:theme", nextTheme);
      } catch {
        // Theme still applies for this session when localStorage is unavailable.
      }

      document.documentElement.classList.toggle("dark", nextTheme === "dark");
      return nextTheme;
    });
  }

  return { theme, toggleTheme };
}

export default function Playground({
  activeLanguage,
  availableLanguages,
  defaultCode,
  lesson,
}: PlaygroundProps) {
  const router = useRouter();
  const [code, setCode] = useState(defaultCode);
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStatus>("standby");
  const [awaitingInput, setAwaitingInput] = useState(false);
  const [isIsolated, setIsIsolated] = useState(true);
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>("code");
  const [guideOpen, setGuideOpen] = useState(true);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved");
  const [storageAvailable, setStorageAvailable] = useState(true);
  const [lastRun, setLastRun] = useState<LastRun | null>(null);
  const [terminalTranscript, setTerminalTranscript] = useState("");
  const { theme, toggleTheme } = useTheme();

  const storageKey = useMemo(
    () => getStorageKey(activeLanguage.id, lesson?.lessonSlug),
    [activeLanguage.id, lesson?.lessonSlug],
  );
  const activeLessons = useMemo(
    () =>
      lessonStarters.filter((starter) => starter.languageId === activeLanguage.id),
    [activeLanguage.id],
  );
  const plannedLanguages = useMemo(
    () => availableLanguages.filter((language) => language.status === "planned"),
    [availableLanguages],
  );
  const codeStats = useMemo(() => getCodeStats(code), [code]);
  const statusMeta = runtimeStatusMeta[runtimeStatus];
  const saveMeta = saveStatusMeta[saveStatus];
  const activePlaygroundPath = activeLanguage.playgroundPath ?? "/python";
  const currentFileName = `${lesson?.lessonSlug ?? "scratch"}.${activeLanguage.fileExtension}`;
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
  const runStartedAtRef = useRef<number | null>(null);

  const terminalHostRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const currentInputRef = useRef("");
  const awaitingInputRef = useRef(false);
  const runtimeStatusRef = useRef<RuntimeStatus>("standby");
  const hasLoggedSupportErrorRef = useRef(false);

  const resetActiveWorkerClient = useCallback(() => {
    if (activeLanguage.runtime === "pyodide") {
      resetPythonWorkerClient();
      return;
    }

    if (activeLanguage.runtime === "quickjs") {
      resetJavaScriptWorkerClient();
    }
  }, [activeLanguage.runtime]);

  const warmActiveWorker = useCallback(() => {
    if (activeLanguage.runtime === "pyodide") {
      warmPythonWorker();
      return;
    }

    if (activeLanguage.runtime === "quickjs") {
      warmJavaScriptWorker();
    }
  }, [activeLanguage.runtime]);

  const writeTerminal = useCallback((text: string) => {
    terminalRef.current?.write(normalizeTerminalText(text));
    setTerminalTranscript((current) => appendTerminalTranscript(current, text));
  }, []);

  const writelnTerminal = useCallback(
    (text: string) => {
      writeTerminal(`${text}\n`);
    },
    [writeTerminal],
  );

  const completeRun = useCallback((outcome: LastRunOutcome) => {
    const startedAt = runStartedAtRef.current;
    const durationMs = startedAt ? performance.now() - startedAt : 0;

    runStartedAtRef.current = null;
    setLastRun({
      durationMs,
      outcome,
    });
  }, []);

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
          completeRun("success");
          activeRequestIdRef.current = null;
          break;
        case "interrupted":
          setAwaitingInput(false);
          currentInputRef.current = "";
          writelnTerminal("^C");
          setRuntimeStatus("stopped");
          completeRun("stopped");
          activeRequestIdRef.current = null;
          break;
        case "error":
          setAwaitingInput(false);
          writelnTerminal(message.error);
          setRuntimeStatus("error");
          completeRun("error");
          activeRequestIdRef.current = null;
          break;
      }
    },
    [completeRun, writeTerminal, writelnTerminal],
  );

  const handleWorkerError = useCallback(
    (event: ErrorEvent) => {
      writelnTerminal(event.message);
      setRuntimeStatus("error");
      completeRun("error");
      activeRequestIdRef.current = null;
    },
    [completeRun, writelnTerminal],
  );

  const ensureWorker = useCallback(() => {
    if (workerRef.current) {
      return workerRef.current;
    }

    if (activeLanguage.runtime !== "pyodide" && activeLanguage.runtime !== "quickjs") {
      return null;
    }

    const workerClient =
      activeLanguage.runtime === "pyodide"
        ? getPythonWorkerClient()
        : getJavaScriptWorkerClient();
    const { worker } = workerClient;

    worker.addEventListener("message", handleWorkerMessage);
    worker.addEventListener("error", handleWorkerError);
    stdinMetaRef.current = workerClient.stdinMeta;
    stdinBytesRef.current = workerClient.stdinBytes;
    interruptBufferRef.current = workerClient.interruptBuffer;
    workerRef.current = worker;
    return worker;
  }, [activeLanguage.runtime, handleWorkerError, handleWorkerMessage]);

  const resetTerminal = useCallback(() => {
    currentInputRef.current = "";
    setTerminalTranscript("");
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
      resetActiveWorkerClient();
      workerRef.current = null;
      stdinMetaRef.current = null;
      stdinBytesRef.current = null;
      interruptBufferRef.current = null;
      activeRequestIdRef.current = null;
      setRuntimeStatus("stopped");
      completeRun("stopped");
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
    resetActiveWorkerClient();
    workerRef.current = null;
    stdinMetaRef.current = null;
    stdinBytesRef.current = null;
    interruptBufferRef.current = null;
    activeRequestIdRef.current = null;
    setAwaitingInput(false);
    setRuntimeStatus("stopped");
    completeRun("stopped");
    writelnTerminal("^C");
  }, [
    completeRun,
    handleWorkerError,
    handleWorkerMessage,
    resetActiveWorkerClient,
    writelnTerminal,
  ]);

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
    if (persistTimeoutRef.current !== null) {
      window.clearTimeout(persistTimeoutRef.current);
      persistTimeoutRef.current = null;
    }

    hasLoggedSupportErrorRef.current = false;
    const storedCode = readStoredCode(storageKey);
    const nextCode = storedCode || defaultCode;
    codeRef.current = nextCode;
    queueMicrotask(() => {
      setCode(nextCode);
      setSaveStatus("saved");
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
    warmActiveWorker();
  }, [warmActiveWorker]);

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
    terminal.textarea?.setAttribute("aria-label", `${activeLanguage.label} terminal`);
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
  }, [activeLanguage.label, handleTerminalData]);

  useEffect(() => {
    if (isIsolated || hasLoggedSupportErrorRef.current || !terminalRef.current) {
      return;
    }

    hasLoggedSupportErrorRef.current = true;
    if (activeLanguage.runtime === "pyodide" || activeLanguage.runtime === "quickjs") {
      const warning = INTERACTIVE_WARNINGS[activeLanguage.runtime];
      queueMicrotask(() => writelnTerminal(warning));
    }
  }, [activeLanguage.runtime, isIsolated, writelnTerminal]);

  useEffect(() => {
    return () => {
      if (persistTimeoutRef.current !== null) {
        window.clearTimeout(persistTimeoutRef.current);
      }
      workerRef.current?.removeEventListener("message", handleWorkerMessage);
      workerRef.current?.removeEventListener("error", handleWorkerError);
      resetActiveWorkerClient();
      workerRef.current = null;
      stdinMetaRef.current = null;
      stdinBytesRef.current = null;
      interruptBufferRef.current = null;
    };
  }, [handleWorkerError, handleWorkerMessage, resetActiveWorkerClient]);

  const handleCodeChange = useCallback(
    (value: string) => {
      codeRef.current = value;
      setCode(value);
      setSaveStatus("saving");

      if (persistTimeoutRef.current !== null) {
        window.clearTimeout(persistTimeoutRef.current);
      }

      persistTimeoutRef.current = window.setTimeout(() => {
        const persisted = persistCode(storageKey, value);
        setStorageAvailable(persisted);
        setSaveStatus(persisted ? "saved" : "blocked");
        persistTimeoutRef.current = null;
      }, 300);
    },
    [storageKey],
  );

  const handleRun = useCallback(() => {
    if (isProgramActive) {
      return;
    }

    const languageId = activeLanguage.id;
    if (
      languageId !== "python" &&
      languageId !== "javascript" &&
      languageId !== "typescript"
    ) {
      return;
    }

    const worker = ensureWorker();
    if (!worker) {
      return;
    }

    resetTerminal();
    const requestId = `${languageId}-${Date.now()}-${++requestSequenceRef.current}`;
    activeRequestIdRef.current = requestId;
    runStartedAtRef.current = performance.now();
    setLastRun(null);
    setRuntimeStatus("loading");
    setMobilePanel("output");

    worker.postMessage({
      type: "run",
      code: codeRef.current,
      requestId,
      language: languageId,
    } satisfies WorkerInboundMessage);
  }, [activeLanguage.id, ensureWorker, isProgramActive, resetTerminal]);

  const handleClearOutput = useCallback(() => {
    resetTerminal();
    terminalRef.current?.focus();
  }, [resetTerminal]);

  const handleResetCode = useCallback(() => {
    codeRef.current = defaultCode;
    setCode(defaultCode);
    const persisted = persistCode(storageKey, defaultCode);
    setStorageAvailable(persisted);
    setSaveStatus(persisted ? "saved" : "blocked");
  }, [defaultCode, storageKey]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        if (isProgramActive) {
          handleStop();
        } else {
          handleRun();
        }
        return;
      }

      if (event.key === "Escape" && isProgramActive) {
        event.preventDefault();
        handleStop();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleRun, handleStop, isProgramActive]);

  return (
    <main className="flex h-dvh min-h-0 flex-col overflow-hidden bg-canvas text-ink">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-line bg-panel px-3 sm:px-4">
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            className="focus-ring hidden size-9 shrink-0 items-center justify-center rounded-md border border-line text-muted transition hover:bg-panel-strong hover:text-ink lg:inline-flex"
            onClick={() => setGuideOpen((current) => !current)}
            aria-label={guideOpen ? "Collapse lesson panel" : "Open lesson panel"}
          >
            {guideOpen ? <PanelLeftClose size={17} /> : <PanelLeftOpen size={17} />}
          </button>
          <Link
            href={activePlaygroundPath}
            className="focus-ring flex min-w-0 items-center gap-2 rounded-md text-sm font-semibold text-ink hover:text-accent"
          >
            <span className="grid size-8 shrink-0 place-items-center rounded-md bg-accent-soft text-accent">
              <Code2 size={17} />
            </span>
            <span className="hidden truncate sm:inline">Playground</span>
          </Link>
          <select
            className="focus-ring h-9 min-w-0 rounded-md border border-line bg-panel-strong px-2 text-sm text-ink"
            value={activeLanguage.id}
            aria-label="Language"
            onChange={(event) => {
              const nextLanguage = availableLanguages.find(
                (language) => language.id === event.target.value,
              );

              if (nextLanguage?.playgroundPath && nextLanguage.status === "ready") {
                router.push(nextLanguage.playgroundPath);
              }
            }}
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

        <div className="flex min-w-0 items-center gap-2">
          <span
            className={`hidden h-8 items-center gap-2 rounded-md border px-2.5 text-xs font-medium md:inline-flex ${getPillClass(
              statusMeta.tone,
            )}`}
          >
            {runtimeStatus === "loading" ? (
              <LoaderCircle size={14} className="animate-spin" />
            ) : (
              <span className={`size-2 rounded-full ${getDotClass(statusMeta.tone)}`} />
            )}
            {statusMeta.label}
          </span>
          <button
            type="button"
            className="focus-ring inline-flex h-9 shrink-0 items-center gap-2 rounded-md border border-accent/35 bg-accent px-3 text-sm font-semibold text-white transition hover:bg-accent/90 disabled:opacity-50"
            onClick={isProgramActive ? handleStop : handleRun}
            disabled={false}
            title={isProgramActive ? "Stop" : "Run"}
          >
            {isProgramActive ? <Square size={15} /> : <Play size={15} />}
            <span className="hidden sm:inline">{isProgramActive ? "Stop" : "Run"}</span>
          </button>
          <button
            type="button"
            className="focus-ring hidden size-9 shrink-0 items-center justify-center rounded-md border border-line bg-panel-strong text-muted transition hover:text-ink sm:inline-flex"
            onClick={handleResetCode}
            aria-label="Reset code"
            title="Reset code"
          >
            <RotateCcw size={16} />
          </button>
          <button
            type="button"
            className="focus-ring size-9 shrink-0 rounded-md border border-line bg-panel-strong text-muted transition hover:text-ink"
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

      <div className="grid h-12 shrink-0 grid-cols-3 border-b border-line bg-panel px-2 py-2 text-sm md:hidden">
        {mobilePanels.map((panel) => (
          <button
            key={panel.id}
            type="button"
            className={`focus-ring inline-flex items-center justify-center gap-2 rounded-md px-3 font-medium ${
              mobilePanel === panel.id
                ? "bg-accent-soft text-ink"
                : "text-muted hover:text-ink"
            }`}
            onClick={() => setMobilePanel(panel.id)}
          >
            {panel.label}
            {panel.id === "output" && awaitingInput ? (
              <span className="size-2 rounded-full bg-amber-500" />
            ) : null}
          </button>
        ))}
      </div>

      <section
        className={`grid flex-1 min-h-0 grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(320px,0.52fr)] ${
          guideOpen ? "lg:grid-cols-[280px_minmax(0,1fr)_minmax(360px,0.52fr)]" : ""
        }`}
      >
        <aside
          className={`min-h-0 overflow-auto border-r border-line bg-panel px-3 py-4 md:hidden lg:block ${
            guideOpen ? "" : "lg:hidden"
          } ${mobilePanel === "guide" ? "block" : "hidden"}`}
        >
          <div className="mb-4 space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <BookOpen size={16} />
              {activeLanguage.label} starters
            </div>
            <div className="rounded-md border border-line bg-panel-strong p-3">
              <p className="text-sm font-medium text-ink">
                {lesson?.title ?? "Scratch"}
              </p>
              <p className="mt-1 text-xs text-muted">
                {activeLessons.length} starters linked to learn.colinkim.dev
              </p>
            </div>
          </div>

          <nav className="space-y-1" aria-label={`${activeLanguage.label} lesson starters`}>
            <Link
              href={activePlaygroundPath}
              className={`block rounded-md px-3 py-2 text-sm transition ${
                !lesson
                  ? "bg-accent-soft text-ink"
                  : "text-muted hover:bg-panel-strong hover:text-ink"
              }`}
            >
              Scratch
            </Link>
            {activeLessons.map((starter) => (
              <Link
                key={starter.lessonSlug}
                href={`${activePlaygroundPath}?lesson=${starter.lessonSlug}`}
                className={`block rounded-md px-3 py-2 text-sm transition ${
                  lesson?.lessonSlug === starter.lessonSlug
                    ? "bg-accent-soft text-ink"
                    : "text-muted hover:bg-panel-strong hover:text-ink"
                }`}
              >
                {starter.title}
              </Link>
            ))}
          </nav>

          {plannedLanguages.length > 0 ? (
            <div className="mt-6 border-t border-line pt-4">
              <p className="text-xs font-semibold uppercase text-muted">
                Future runtimes
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {plannedLanguages.map((language) => (
                  <span
                    key={language.id}
                    className="rounded-md border border-line bg-panel-strong px-2 py-1 text-xs text-muted"
                  >
                    {language.label} planned
                  </span>
                ))}
              </div>
            </div>
          ) : null}
        </aside>

        <section
          className={`h-full min-h-0 grid-rows-[auto_1fr_auto] overflow-hidden border-line bg-code-panel md:grid ${
            mobilePanel === "code" ? "grid" : "hidden"
          }`}
        >
          <div className="flex h-11 shrink-0 items-center justify-between gap-3 border-b border-white/10 bg-black/10 px-3 text-slate-300">
            <div className="flex min-w-0 items-center gap-2">
              <FileCode2 size={15} className="shrink-0 text-slate-400" />
              <span className="truncate text-sm font-medium">{currentFileName}</span>
              <span className="hidden rounded-sm bg-white/10 px-2 py-0.5 text-xs text-slate-400 sm:inline">
                {activeLanguage.runtimeLabel}
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span
                className={`inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs ${getPillClass(
                  saveMeta.tone,
                )}`}
              >
                {saveStatus === "saved" ? <CheckCircle2 size={13} /> : <Save size={13} />}
                <span className="hidden sm:inline">{saveMeta.label}</span>
              </span>
              <span className="hidden text-xs text-slate-400 sm:inline">
                {numberFormatter.format(codeStats.lines)} lines
              </span>
            </div>
          </div>
          <div className="min-h-0">
            <CodeEditor
              code={code}
              language={activeLanguage}
              onCodeChange={handleCodeChange}
            />
          </div>
          <div className="flex h-8 shrink-0 items-center justify-between gap-3 border-t border-white/10 bg-black/10 px-3 text-xs text-slate-400">
            <span className="truncate">
              {storageAvailable ? "Local autosave active" : "Local autosave unavailable"}
            </span>
            <span className="shrink-0">
              {numberFormatter.format(codeStats.characters)} chars
            </span>
          </div>
        </section>

        <section
          className={`h-full min-h-0 grid-rows-[auto_1fr_auto] border-l border-line bg-code md:grid ${
            mobilePanel === "output" ? "grid" : "hidden"
          }`}
        >
          <div className="flex h-11 shrink-0 items-center justify-between gap-3 border-b border-white/10 bg-black/10 px-3">
            <div className="flex min-w-0 items-center gap-2">
              <TerminalSquare size={15} className="shrink-0 text-slate-400" />
              <span className="code-font text-xs font-medium uppercase text-slate-300">
                Output
              </span>
              {!isIsolated ? (
                <span className="hidden rounded-md bg-white/10 px-2 py-1 text-xs text-slate-300 sm:inline">
                  Basic runtime
                </span>
              ) : null}
            </div>
            <button
              type="button"
              className="focus-ring inline-flex size-8 shrink-0 items-center justify-center rounded-md text-slate-400 transition hover:bg-white/10 hover:text-slate-100"
              onClick={handleClearOutput}
              aria-label="Clear output"
              title="Clear output"
            >
              <Trash2 size={15} />
            </button>
          </div>
          <div ref={terminalHostRef} className="terminal-host min-h-0 p-3" />
          <pre className="sr-only" aria-live="polite">
            {terminalTranscript}
          </pre>
          <div className="flex h-8 shrink-0 items-center justify-between gap-3 border-t border-white/10 bg-black/10 px-3 text-xs text-slate-400">
            <span className="inline-flex min-w-0 items-center gap-1.5 truncate">
              {isIsolated ? (
                <>
                  <ShieldCheck size={13} className="shrink-0 text-emerald-300" />
                  <span className="truncate">Interactive input enabled</span>
                </>
              ) : (
                <>
                  <AlertTriangle size={13} className="shrink-0 text-amber-300" />
                  <span className="truncate">Interactive bridge limited</span>
                </>
              )}
            </span>
            <span className="inline-flex shrink-0 items-center gap-1.5">
              <Clock3 size={13} />
              {lastRun
                ? `${lastRun.outcome} ${formatDuration(lastRun.durationMs)}`
                : "No run yet"}
            </span>
          </div>
        </section>
      </section>
    </main>
  );
}
