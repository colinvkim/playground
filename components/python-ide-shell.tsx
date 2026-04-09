"use client";

import dynamic from "next/dynamic";

const PythonIde = dynamic(() => import("@/components/python-ide"), {
  ssr: false,
  loading: () => <main className="ide-shell" />,
});

export default function PythonIdeShell() {
  return <PythonIde />;
}
