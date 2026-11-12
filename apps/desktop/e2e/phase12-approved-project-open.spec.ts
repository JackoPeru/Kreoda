import { test, expect } from "@playwright/test";
import { createServer } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { boot, runBar, snapOf } from "./helpers";
import { SessionClient } from "./ws-test-client";

test("real native .icad opens remotely only after explicit Desktop consent and rotates session", async () => {
  const server = createServer();
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  await new Promise<void>(resolve => server.close(() => resolve()));
  const profile = mkdtempSync(path.join(os.tmpdir(), "kreoda-approved-open-"));
  const filename = path.join(profile, "approved.icad");
  const token = `approved-open-${process.pid}`;
  const { app, window } = await boot({ KREODA_BACKGROUND_TEST: "1", KREODA_SESSION_PORT: String(port), KREODA_SESSION_TOKEN: token }, [`--user-data-dir=${profile}`]);
  const peer = new SessionClient();
  try {
    await runBar(window, "box 25 20 10");
    await window.evaluate(async file => {
      const api = (window as unknown as { __kreoda_test: { saveIcad: (path: string) => Promise<unknown> };
        kreoda: { recentProjectsRecord: (path: string) => Promise<unknown> } });
      await api.__kreoda_test.saveIcad(file);
      await api.kreoda.recentProjectsRecord(file);
    }, filename);
    await runBar(window, "box 4 4 4");
    expect((await snapOf(window)).bodies).toHaveLength(2);

    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false });
    });
    const oldHello = await peer.connect(token, port);
    const deniedList = (await peer.call("listOpenableProjects", {}))["result"] as {
      projects: { projectId: string }[]; sessionId: string; documentId: string; revision: number;
    };
    await expect(peer.call("requestOpenProject", {
      projectId: deniedList.projects[0]!.projectId, sessionId: deniedList.sessionId,
      documentId: deniedList.documentId, expectedRevision: deniedList.revision,
    })).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    expect((await snapOf(window)).bodies).toHaveLength(2);

    // Explicit approval is supplied by the Electron process test harness.
    // The core, session listener and file open are real; no native mocks.
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
    });
    const listed = (await peer.call("listOpenableProjects", {}))["result"] as {
      projects: { projectId: string; name: string; openedAt: number }[];
      sessionId: string; documentId: string; revision: number;
    };
    expect(listed.projects).toEqual([expect.objectContaining({ name: "approved.icad", projectId: expect.any(String) })]);
    expect(JSON.stringify(listed)).not.toContain(profile);
    const opened = (await peer.call("requestOpenProject", { projectId: listed.projects[0]!.projectId,
      sessionId: listed.sessionId, documentId: listed.documentId, expectedRevision: listed.revision }))["result"] as { status: string; sessionId: string };
    expect(opened.status).toBe("opened");
    expect(opened.sessionId).not.toBe(oldHello["sessionId"]);
    await expect.poll(async () => (await snapOf(window)).bodies.length).toBe(1);
    const snapshot = await snapOf(window);
    expect(snapshot.bodies[0]!.volumeMm3).toBeCloseTo(5000, 0);
  } finally {
    peer.closeRaw();
    await app.close();
    rmSync(profile, { recursive: true, force: true });
  }
});
