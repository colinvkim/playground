import type { PlaygroundLanguage } from "@/lib/playground-catalog";

const STORAGE_PREFIX = "learn-playground";

export function getStorageKey(
  languageId: PlaygroundLanguage["id"],
  lessonSlug?: string,
) {
  return [STORAGE_PREFIX, languageId, lessonSlug ?? "scratch"].join(":");
}

export function readStoredCode(key: string) {
  if (typeof window === "undefined") {
    return "";
  }

  return window.localStorage.getItem(key) ?? "";
}

export function persistCode(key: string, code: string) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(key, code);
}
