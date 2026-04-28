"use client";

import { memo, useMemo } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { oneDark } from "@codemirror/theme-one-dark";
import { EditorView, placeholder } from "@codemirror/view";
import type { PlaygroundLanguage } from "@/lib/playground-catalog";

const editorTheme = EditorView.theme({
  "&": {
    height: "100%",
    fontSize: "15px",
    lineHeight: "1.65",
    backgroundColor: "var(--color-code-panel)",
  },
  ".cm-content": {
    caretColor: "#f8fafc",
    padding: "16px 0 24px",
    tabSize: "4",
  },
  ".cm-line": {
    padding: "0 16px",
  },
  ".cm-gutters": {
    backgroundColor: "var(--color-code-panel)",
    border: "none",
    color: "#64748b",
    minWidth: "42px",
    paddingRight: "4px",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "rgba(56, 189, 248, 0.14)",
  },
  ".cm-activeLine": {
    backgroundColor: "rgba(148, 163, 184, 0.08)",
  },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
    backgroundColor: "rgba(56, 189, 248, 0.24)",
  },
  ".cm-cursor": {
    borderLeftWidth: "2px",
  },
  ".cm-placeholder": {
    color: "rgba(148, 163, 184, 0.62)",
    paddingLeft: "16px",
  },
  ".cm-scroller": {
    overflow: "auto",
    overscrollBehavior: "contain",
    touchAction: "pan-x pan-y",
  },
  ".cm-sizer": {
    minWidth: "100%",
    width: "fit-content",
  },
});

type CodeEditorProps = {
  code: string;
  language: PlaygroundLanguage;
  onCodeChange: (value: string) => void;
};

function getLanguageExtension(language: PlaygroundLanguage) {
  switch (language.id) {
    case "javascript":
      return javascript();
    case "typescript":
      return javascript({ typescript: true });
    case "python":
    default:
      return python();
  }
}

function CodeEditorComponent({ code, language, onCodeChange }: CodeEditorProps) {
  const extensions = useMemo(
    () => [
      getLanguageExtension(language),
      editorTheme,
      placeholder(`Write ${language.label} here, then run it.`),
      EditorView.contentAttributes.of({
        autocapitalize: "off",
        autocomplete: "off",
        autocorrect: "off",
        spellcheck: "false",
      }),
    ],
    [language],
  );

  function handleChange(value: string) {
    onCodeChange(value);
  }

  return (
    <CodeMirror
      value={code}
      height="100%"
      theme={oneDark}
      autoCorrect="off"
      autoCapitalize="off"
      spellCheck={false}
      basicSetup={{
        lineNumbers: true,
        foldGutter: false,
        dropCursor: false,
        highlightActiveLineGutter: true,
        highlightSpecialChars: false,
        bracketMatching: true,
        closeBrackets: false,
        indentOnInput: true,
        autocompletion: false,
        completionKeymap: false,
      }}
      extensions={extensions}
      onChange={handleChange}
    />
  );
}

const CodeEditor = memo(CodeEditorComponent);

export default CodeEditor;
