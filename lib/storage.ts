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

  try {
    return window.localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

export function persistCode(key: string, code: string) {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    window.localStorage.setItem(key, code);
    return true;
  } catch {
    return false;
  }
}
