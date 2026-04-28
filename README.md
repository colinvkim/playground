# learn.colinkim.dev playground

Focused browser playground infrastructure for `learn.colinkim.dev`.

## What Runs Today

- `/` and `/python` load the Python playground.
- Python executes locally in a Pyodide web worker.
- CodeMirror powers the editor, xterm powers the terminal.
- `?lesson=<slug>` selects a lesson starter from `lib/playground-catalog.ts`.
- Code autosaves per language and lesson in localStorage.
- Theme preference stores at `learn-playground:theme`.
- Planned languages are visible in catalog metadata, but stay disabled until runtime support exists.

## Development

```bash
pnpm install
pnpm dev
```

Open `http://localhost:3000/python`.

## Verification

```bash
pnpm lint
pnpm build
```

Runtime/UI smoke checks:

- `/python`
- `/python?lesson=working-with-json`
- Run `print("hello")`
- Run code that raises an exception
- Test `input()` with cross-origin isolation enabled
- Test Stop during a running program
- Confirm autosave, reset, and theme behavior
- Confirm mobile code/output/guide panels do not overlap

## Key Files

- `components/python-playground.tsx`: playground shell, terminal lifecycle, runtime controls.
- `components/python-editor.tsx`: CodeMirror setup.
- `workers/python.worker.ts`: Pyodide execution worker.
- `lib/playground-catalog.ts`: language metadata and lesson starters.
- `lib/python-worker-client.ts`: shared browser-side worker singleton.
- `lib/runtime.ts`: worker protocol.
- `lib/storage.ts`: localStorage helpers.
- `next.config.ts`: cross-origin isolation headers for SharedArrayBuffer.
