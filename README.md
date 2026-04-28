# learn.colinkim.dev playground

Focused browser playground infrastructure for `learn.colinkim.dev`.

## What Runs Today

- `/`, `/python`, `/javascript`, and `/typescript` load runnable playgrounds.
- Python executes locally in a Pyodide web worker.
- JavaScript executes locally in a QuickJS web worker.
- TypeScript transpiles in the browser, then executes through the QuickJS worker.
- CodeMirror powers the language-aware editor, xterm powers the terminal.
- `?lesson=<slug>` selects a lesson starter from `lib/playground-catalog.ts`.
- Code autosaves per language and lesson in localStorage.
- Theme preference stores at `learn-playground:theme`.
- Swift and C++ are visible in catalog metadata, but stay disabled until a separate browser compiler/toolchain path exists.

## Development

```bash
pnpm install
pnpm dev
```

Open `http://localhost:3000/python`, `http://localhost:3000/javascript`, or `http://localhost:3000/typescript`.

## Verification

```bash
pnpm lint
pnpm build
```

Runtime/UI smoke checks:

- `/python`
- `/javascript`
- `/typescript`
- `/python?lesson=working-with-json`
- Run `print("hello")`
- Run JavaScript `console.log("hello")`
- Run TypeScript with type syntax
- Run code that raises an exception
- Test Python `input()` or JS/TS `prompt()` with cross-origin isolation enabled
- Test Stop during a running program
- Confirm autosave, reset, and theme behavior
- Confirm mobile code/output/guide panels do not overlap

## Key Files

- `components/playground.tsx`: playground shell, terminal lifecycle, runtime controls.
- `components/code-editor.tsx`: CodeMirror setup.
- `workers/python.worker.ts`: Pyodide execution worker.
- `workers/javascript.worker.ts`: QuickJS execution and TypeScript transpilation worker.
- `lib/playground-catalog.ts`: language metadata and lesson starters.
- `lib/python-worker-client.ts`: shared browser-side Python worker singleton.
- `lib/javascript-worker-client.ts`: shared browser-side JS/TS worker singleton.
- `lib/runtime.ts`: worker protocol.
- `lib/storage.ts`: localStorage helpers.
- `next.config.ts`: cross-origin isolation headers for SharedArrayBuffer.
