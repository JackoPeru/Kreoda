import { useEffect, useRef, useState } from "react";
import type { SessionConnectionStatus } from "../../../electron/session-control-ui";
import { CadDialog } from "../CadDialog";
import { useT } from "../../i18n";

export function SessionConnectionPanel({ onClose }: { onClose: () => void }) {
  const t = useT();
  const [status, setStatus] = useState<SessionConnectionStatus | null>(null);
  const [host, setHost] = useState("127.0.0.1");
  const [port, setPort] = useState("9860");
  const [pairing, setPairing] = useState<{ token: string; expiresAt: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  const pending = useRef(false);
  const pairedCount = useRef(0);
  useEffect(() => {
    mounted.current = true;
    const refresh = async (): Promise<void> => {
      if (pending.current) return;
      try {
        const next = await window.kreoda.sessionConnectionStatus();
        if (mounted.current) {
          setStatus(next);
          if (!next.listener || next.devices.length > pairedCount.current) setPairing(null);
          pairedCount.current = next.devices.length;
        }
      } catch { if (mounted.current) setError(t("session.failed")); }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 2000);
    return () => {
      mounted.current = false;clearInterval(timer);
      void window.kreoda.sessionCancelPair().catch(() => {});
    };
  }, [t]);
  useEffect(() => {
    if (!pairing) return;
    const timer = setTimeout(() => setPairing(null), Math.max(0, Date.parse(pairing.expiresAt) - Date.now()));
    return () => clearTimeout(timer);
  }, [pairing]);
  const run = async (action: () => Promise<void>): Promise<void> => {
    if (pending.current) return;
    pending.current = true;setBusy(true);setError(null);
    try { await action(); }
    catch { if (mounted.current) setError(t("session.failed")); }
    finally { pending.current = false;if (mounted.current) setBusy(false); }
  };
  const button = "rounded-md bg-white/10 px-3 py-1.5 text-xs hover:bg-white/15 disabled:opacity-40";
  return (
    <CadDialog title={t("session.title")} description={t("session.description")} onClose={onClose}
      error={error} testId="session-connection-panel"
      contentClassName="top-[15vh] max-h-[70vh] w-[26rem] max-w-[92vw] overflow-auto"
      actions={<div className="flex justify-end pt-3"><button className={button} onClick={onClose}>{t("common.close")}</button></div>}>
      <div className="space-y-3 text-xs">
        {status?.listener ? (
          <div className="space-y-2">
            <div>{t("session.enabled")}</div>
            <input aria-label={t("session.address")} readOnly value={`ws://${status.listener.host}:${status.listener.port}`}
              className="w-full rounded bg-black/20 p-2 font-mono" />
            <button className={button} disabled={busy} onClick={() => void run(async () => {
              const next = await window.kreoda.sessionDisable();
              if (mounted.current) { setStatus(next);setPairing(null); }
            })}>{t("session.disable")}</button>
          </div>
        ) : (
          <div className="space-y-2">
            <div>{t("session.disabled")}</div>
            <label className="block">{t("session.interface")}
              <select className="mt-1 w-full rounded bg-[#242b36] p-2" value={host} disabled={busy}
                onChange={event => setHost(event.target.value)}>
                {(status?.interfaces ?? [{ name: "Local", host: "127.0.0.1" }]).map(item =>
                  <option key={item.host} value={item.host}>{item.host === "127.0.0.1" ? t("session.local") : `${item.name} · ${item.host}`}</option>)}
              </select>
            </label>
            <label className="block">{t("session.port")}
              <input className="ml-2 w-24 rounded bg-black/20 p-2" type="number" min={0} max={65535} step={1}
                value={port} disabled={busy} onChange={event => setPort(event.target.value)} />
            </label>
            <button className={button} disabled={busy || !status?.pairingAvailable || !port.trim() || !Number.isInteger(Number(port)) || Number(port) < 0 || Number(port) > 65535}
              onClick={() => void run(async () => {
                const next = await window.kreoda.sessionEnable(host, Number(port));
                if (mounted.current) setStatus(next);
              })}>{t("session.enable")}</button>
          </div>
        )}
        {status && !status.pairingAvailable && <p>{t("session.storageUnavailable")}</p>}
        {status?.listener && <div className="space-y-2 border-t border-white/10 pt-3">
          <button className={button} disabled={busy} onClick={() => void run(async () => {
            const next = await window.kreoda.sessionPair();
            if (mounted.current) { pairedCount.current = status.devices.length;setPairing(next); }
          })}>{t("session.pair")}</button>
          {pairing && <>
            <p>{t("session.pairHint")}</p>
            <input aria-label={t("session.pairToken")} readOnly value={pairing.token} className="w-full rounded bg-black/20 p-2 font-mono text-[11px]" />
            <div className="flex gap-2">
              <button className={button} disabled={busy} onClick={() => void run(() => navigator.clipboard.writeText(pairing.token))}>{t("session.copy")}</button>
              <button className={button} disabled={busy} onClick={() => void run(async () => {
                await window.kreoda.sessionCancelPair();if (mounted.current) setPairing(null);
              })}>{t("common.cancel")}</button>
            </div>
          </>}
        </div>}
        <div className="border-t border-white/10 pt-3">
          <div className="pb-2 font-medium">{t("session.devices")}</div>
          {status?.devices.length === 0 && <p className="text-white/50">{t("session.noDevices")}</p>}
          {status?.devices.map(device => <div key={device.deviceId} className="flex items-center justify-between gap-2 py-1">
            <span className="min-w-0 break-words">{device.name}{status.clients.some(client => client.deviceId === device.deviceId) ? ` · ${t("session.connected")}` : ""}</span>
            <button className={button} disabled={busy} onClick={() => void run(async () => {
              const next = await window.kreoda.sessionRevoke(device.deviceId);if (mounted.current) setStatus(next);
            })}>{t("session.revoke")}</button>
          </div>)}
          <p className="pt-2 text-white/50">{t("session.clientCount", { n: status?.clients.length ?? 0 })}</p>
          {status?.transaction && <p className="pt-1 text-amber-200">{t("session.transaction")}</p>}
        </div>
      </div>
    </CadDialog>
  );
}
