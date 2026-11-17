import { LOCALES, setLocale, useLocale, useT, type Locale } from "../i18n";

/** Persistent UI settings; currently the interface language. */
export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const tt = useT();
  const locale = useLocale();
  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60"
      data-testid="settings-dialog"
    >
      <div className="w-[26rem] max-w-[92vw] rounded-xl border border-white/15 bg-[var(--kreoda-float-elevated-bg)] p-5 shadow-2xl">
        <h2 className="text-sm font-semibold">{tt("settings.title")}</h2>
        <p className="pb-3 pt-1 text-xs text-white/55">{tt("settings.desc")}</p>
        <label className="block text-xs text-white/70">
          {tt("settings.language")}
          <select
            value={locale}
            onChange={(event) => setLocale(event.target.value as Locale)}
            data-testid="settings-language"
            className="mt-1 w-full rounded-md bg-white/5 px-2 py-1.5 text-sm text-white outline-none focus:bg-white/10"
          >
            {LOCALES.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md bg-white/10 px-3 py-1.5 text-sm hover:bg-white/15"
          >
            {tt("common.close")}
          </button>
        </div>
      </div>
    </div>
  );
}
