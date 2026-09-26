// Tiny locale system (§i18n): dictionary lookup + persisted locale, no
// dependency. New language = one file (like it.ts) + one line in
// `dictionaries` below. Defaults to English; Italian (or any future
// language) is opt-in via Settings and persisted in localStorage.
import { useSyncExternalStore } from "react";
import { en, type EnKey } from "./en";
import { it } from "./it";

export type { EnKey };

const dictionaries = { en, it } as const;
export type Locale = keyof typeof dictionaries;
export const LOCALES: { id: Locale; label: string }[] = [
  { id: "en", label: "English" },
  { id: "it", label: "Italiano" },
];

const STORE_KEY = "kreoda.locale";

function detectLocale(): Locale {
  try {
    const stored = localStorage.getItem(STORE_KEY);
    if (stored === "it" || stored === "en") return stored;
    if (
      typeof navigator !== "undefined" &&
      navigator.language.toLowerCase().startsWith("it")
    ) {
      return "it";
    }
  } catch {
    // Private mode etc: fall back to English.
  }
  return "en";
}

let current: Locale = detectLocale();
const listeners = new Set<() => void>();

function applyDocumentLang(): void {
  try {
    document.documentElement.lang = current;
  } catch {
    // Non-DOM (tests): nothing to do.
  }
}
applyDocumentLang();

export function getLocale(): Locale {
  return current;
}

export function setLocale(locale: Locale): void {
  if (locale === current) return;
  current = locale;
  try {
    localStorage.setItem(STORE_KEY, locale);
  } catch {
    // Best-effort persistence.
  }
  applyDocumentLang();
  for (const l of listeners) l();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Current locale snapshot for React (re-renders on language change). */
export function useLocale(): Locale {
  return useSyncExternalStore(subscribe, () => current, () => "en" as Locale);
}

export type Vars = Record<string, string | number>;

/** Translate a key in the current locale, filling {placeholders}. */
export function t(key: EnKey, vars?: Vars): string {
  const dict = dictionaries[current] as Record<EnKey, string>;
  let s: string = dict[key] ?? (dictionaries.en as Record<EnKey, string>)[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      s = s.replaceAll(`{${k}}`, String(v));
    }
  }
  return s;
}

/** React hook: same as t() but re-renders the component on language change. */
export function useT(): (key: EnKey, vars?: Vars) => string {
  useLocale();
  return t;
}

/** Display name of a feature type (Box → Scatola in it). Unknown types pass through. */
export function featureTypeName(type: string): string {
  const dict = dictionaries[current] as Record<string, string>;
  return dict[`ft.${type}`] ?? type;
}

/** Display name of a sketch constraint kind (horizontal → orizzontale in it). */
export function sketchKindName(kind: string): string {
  const dict = dictionaries[current] as Record<string, string>;
  return dict[`sk.${kind}`] ?? kind;
}

/** Test/shutdown helper: reset to the stored-or-default locale. */
export function resetLocaleForTests(): void {
  current = detectLocale();
  applyDocumentLang();
}
