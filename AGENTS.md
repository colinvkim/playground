# AGENTS.md

## Rules

- This is a Next.js 16 app. Before changing Next.js APIs, routing, config, fonts, metadata, workers, or build behavior, read relevant docs from `node_modules/next/dist/docs/`. Do not rely on older Next.js assumptions.
- Use `pnpm` for package tasks.
- Update AGENTS.md when things change.

## Project Shape

- `app/page.tsx`: default playground route.
- `app/python/page.tsx`: Python playground route.
- `components/playground-loader.tsx`: client-only dynamic loader for playground UI.
- `components/python-playground.tsx`: main client UI, terminal, runtime lifecycle, stdin/interrupt bridge, autosave, theme.
- `components/python-editor.tsx`: CodeMirror editor setup.
- `workers/python.worker.ts`: Pyodide runtime worker.
- `lib/playground-catalog.ts`: language catalog and lesson starters.
- `lib/runtime.ts`: worker message protocol and runtime constants.
- `lib/storage.ts`: localStorage keys and persistence helpers.
- `next.config.ts`: cross-origin isolation headers required for SharedArrayBuffer.

## Product Goal

This app is focused playground infrastructure for `learn.colinkim.dev`.

Current v1 behavior:

- `/` and `/python` render same Python playground experience.
- Python runs locally in browser through Pyodide worker.
- CodeMirror provides editor experience with Python language support.
- xterm provides output and interactive input surface.
- Lesson routes use `?lesson=<slug>` and map to starter snippets.
- User code autosaves per language and lesson in localStorage.
- Theme toggle stores `learn-playground:theme`.
- Other languages may appear in catalog as `planned`, but must not imply runnable support.

## Runtime Invariants

- Keep Pyodide execution inside `workers/python.worker.ts`. Do not run user Python on main thread.
- Keep worker protocol types in `lib/runtime.ts` synchronized with both worker and UI.
- Preserve `requestId` filtering. Stale worker messages must not mutate current run state.
- Preserve graceful degradation when `SharedArrayBuffer` or `window.crossOriginIsolated` is unavailable. Basic execution should still work; `input()` and soft interrupt may be limited.
- Preserve cross-origin isolation headers in `next.config.ts` unless replacing them with an equivalent tested setup:
  - `Cross-Origin-Opener-Policy: same-origin`
  - `Cross-Origin-Embedder-Policy: require-corp`
- Do not increase `STDIN_CAPACITY_BYTES` casually. If changed, check buffer layout and UI error text.
- Maintain interrupt semantics:
  - Shared buffer available: post `stop`, set interrupt signal, let Pyodide raise `KeyboardInterrupt`.
  - Shared buffer unavailable: terminate worker and reset refs cleanly.
- Do not import browser-only APIs into server components. Keep terminal/editor/runtime UI behind client components.

## UI Rules

- Keep dense playground layout: header, optional lesson panel, editor, output terminal.
- Maintain mobile panel switching for `code`, `output`, and `guide`.
- Use lucide icons when possible.
- Keep terminal and editor stable in fixed-height viewport. Avoid layout shifts during run/input/status changes.
- Use existing design tokens from `app/globals.css`: `canvas`, `panel`, `panel-strong`, `ink`, `muted`, `line`, `accent`, `accent-soft`, `code`, `code-panel`.
- Preserve JetBrains Mono for editor and terminal.

## Lessons And Languages

- Add lesson starters in `lib/playground-catalog.ts`.
- Lesson slugs must match learn course paths.
- Starter snippets should be short, runnable, and relevant to lesson concept.
- Use `getStorageKey(languageId, lessonSlug)` shape for per-lesson autosave.
- New languages need catalog entry first. Mark `status: "planned"` until runtime, editor language, execution, and UI states are implemented.
- Do not enable language selector routes before runtime exists.

## Code Style

- TypeScript strictness matters. Prefer explicit union types for runtime states and message protocols.
- Keep client state local unless shared behavior justifies extraction.
- Prefer small pure helpers near usage for UI formatting and normalization.

## Verification

Run relevant checks before handing off on big changes:

```bash
rtk pnpm lint
rtk pnpm build
```

For runtime/UI changes, also smoke-test in browser:

- `/python`
- `/python?lesson=working-with-json`
- Run simple `print("hello")`
- Run code that raises an exception
- Test `input()` in cross-origin isolated context
- Test Stop during a running program
- Confirm local autosave and reset behavior
- Confirm mobile layout does not overlap controls

## Dependency Rules

- Prefer existing dependencies before adding new ones.
- If adding runtime/editor packages, explain why existing CodeMirror, xterm, Pyodide, React, or Next APIs are insufficient.

## Git Safety

- Worktree may contain user edits. Never revert changes you did not make.
- Before editing, inspect relevant files.
- Do not run destructive git commands unless user explicitly asks.
- Use Conventional Commits format for commits: `fix:`, `feat:`, `chore:`, `refactor:`, `docs:`, etc.
