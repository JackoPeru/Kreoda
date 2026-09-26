// Unit-test locale pin (§i18n): specs assert English chrome, so the suite
// never depends on the host OS/browser language.
try {
  localStorage.setItem("kreoda.locale", "en");
} catch {
  // Non-DOM: detectLocale() already falls back to English.
}
