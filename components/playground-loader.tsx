"use client";

import dynamic from "next/dynamic";
import type {
  LessonStarter,
  PlaygroundLanguage,
} from "@/lib/playground-catalog";

const PythonPlayground = dynamic(() => import("@/components/python-playground"), {
  ssr: false,
  loading: () => (
    <main className="flex h-dvh items-center justify-center bg-canvas text-sm text-muted">
      Loading playground...
    </main>
  ),
});

type PlaygroundLoaderProps = {
  activeLanguage: PlaygroundLanguage;
  availableLanguages: PlaygroundLanguage[];
  defaultCode: string;
  lesson?: LessonStarter;
};

export default function PlaygroundLoader(props: PlaygroundLoaderProps) {
  return <PythonPlayground {...props} />;
}
