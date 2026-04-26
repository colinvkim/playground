"use client";

import dynamic from "next/dynamic";
import { Braces, LoaderCircle, Terminal } from "lucide-react";
import type {
  LessonStarter,
  PlaygroundLanguage,
} from "@/lib/playground-catalog";
import { warmPythonWorker } from "@/lib/python-worker-client";

const MIN_LOADING_MS = 1000;

function waitForMinimumLoadingTime() {
  warmPythonWorker();

  return new Promise((resolve) => {
    window.setTimeout(resolve, MIN_LOADING_MS);
  });
}

function LoadingPlayground() {
  return (
    <main
      className="playground-loading grid h-dvh place-items-center overflow-hidden bg-canvas px-4 text-ink"
      aria-live="polite"
      aria-busy="true"
    >
      <section className="loading-playground-panel w-full max-w-3xl overflow-hidden rounded-lg border border-line bg-panel shadow-[0_24px_70px_color-mix(in_oklch,var(--color-ink)_10%,transparent)]">
        <div className="flex items-center justify-between gap-4 border-b border-line bg-panel-strong px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-md bg-accent-soft text-accent">
              <Braces size={18} />
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-ink">Python playground</p>
              <p className="truncate text-xs text-muted">Loading editor and runtime</p>
            </div>
          </div>
          <LoaderCircle className="shrink-0 animate-spin text-accent" size={18} />
        </div>

        <div className="grid min-h-64 grid-cols-1 bg-code-panel md:grid-cols-[minmax(0,1fr)_minmax(260px,0.56fr)]">
          <div className="space-y-3 p-4">
            <div className="flex items-center gap-2">
              <span className="h-2 w-16 rounded-full bg-white/20" />
              <span className="h-2 w-10 rounded-full bg-white/10" />
              <span className="h-2 w-12 rounded-full bg-white/10" />
            </div>
            <div className="loading-code-lines space-y-2">
              <span className="block h-3 w-8/12 rounded-full bg-white/14" />
              <span className="block h-3 w-5/12 rounded-full bg-white/10" />
              <span className="ml-5 block h-3 w-7/12 rounded-full bg-white/14" />
              <span className="ml-5 block h-3 w-4/12 rounded-full bg-white/10" />
              <span className="block h-3 w-6/12 rounded-full bg-white/14" />
              <span className="ml-5 block h-3 w-9/12 rounded-full bg-white/10" />
            </div>
          </div>

          <div className="border-t border-white/10 bg-code md:border-l md:border-t-0">
            <div className="flex h-11 items-center gap-2 border-b border-white/10 bg-black/10 px-4">
              <Terminal size={15} className="text-slate-400" />
              <span className="code-font text-xs font-medium uppercase text-slate-300">
                Output
              </span>
            </div>
            <div className="space-y-3 p-4">
              <span className="block h-3 w-7/12 rounded-full bg-emerald-200/20" />
              <span className="block h-3 w-5/12 rounded-full bg-sky-200/16" />
              <span className="block h-3 w-8/12 rounded-full bg-slate-100/10" />
            </div>
          </div>
        </div>

        <div className="h-1 overflow-hidden bg-line">
          <span className="loading-playground-bar block h-full w-2/5 bg-accent" />
        </div>
      </section>
    </main>
  );
}

const PythonPlayground = dynamic(
  () =>
    Promise.all([
      import("@/components/python-playground"),
      waitForMinimumLoadingTime(),
    ]).then(([module]) => module),
  {
    ssr: false,
    loading: LoadingPlayground,
  },
);

type PlaygroundLoaderProps = {
  activeLanguage: PlaygroundLanguage;
  availableLanguages: PlaygroundLanguage[];
  defaultCode: string;
  lesson?: LessonStarter;
};

export default function PlaygroundLoader(props: PlaygroundLoaderProps) {
  return (
    <div className="playground-loader-frame h-dvh overflow-hidden bg-canvas">
      <PythonPlayground {...props} />
    </div>
  );
}
