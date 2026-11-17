import { test, expect, _electron as electron } from "@playwright/test";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { MAIN, hideForBackgroundE2E, runBar, snapOf } from "./helpers";
import { SessionClient } from "./ws-test-client";

test("Phase12 revoked shared edit target clears Desktop and fresh device rejoins current CAD revision", async () => {
  const profile=mkdtempSync(path.join(os.tmpdir(),"kreoda-phase12-revoke-"));
  const app=await electron.launch({executablePath:createRequire(import.meta.url)("electron") as string,
    args:[MAIN,"--no-sandbox","--lang=en-US",`--user-data-dir=${profile}`],
    env:{...process.env,KREODA_SESSION_PORT:"",KREODA_SESSION_TOKEN:"",KREODA_RECOVERY_DIR:profile}});
  const peers:SessionClient[]=[];
  try {
    const page=await app.firstWindow();await hideForBackgroundE2E(app);
    await expect.poll(()=>page.evaluate(()=>window.kreoda.coreInfo().then(x=>x.running))).toBe(true);
    await expect.poll(()=>page.evaluate(()=>Boolean((window as unknown as {__kreoda_test?:unknown}).__kreoda_test))).toBe(true);
    await page.evaluate(()=>(window as unknown as {__kreoda_test:{openWorkspace():void}}).__kreoda_test.openWorkspace());
    await expect(page.getByTestId("workspace-chrome")).toBeVisible();
    await runBar(page,"box 20 30 10");
    const source=await snapOf(page);
    const feature=source.bodies[0]!.id;
    const enabled=await page.evaluate(()=>window.kreoda.sessionEnable("127.0.0.1",0));
    const url=`ws://127.0.0.1:${enabled.listener!.port}`;
    const pair=await page.evaluate(()=>window.kreoda.sessionPair());
    const first=new SessionClient();peers.push(first);
    const auth=await first.pair(url,pair.token);
    const original=await first.call("snapshot");
    expect(original["revision"]).toBe(source.revision);
    await first.call("setSelection",{ids:[`${feature}:box.+Z`],publish:true});
    await expect(page.getByTestId("shared-target-chip")).toContainText(`${feature}:box.+Z`);
    await page.evaluate(id=>window.kreoda.sessionRevoke(id),auth.deviceId);
    await expect(page.getByTestId("shared-target-chip")).toHaveCount(0);
    const denied=new SessionClient();peers.push(denied);
    await expect(denied.connectDevice(url,auth.deviceId,auth.credential)).rejects.toMatchObject({code:"UNAUTHORIZED"});
    const rePair=await page.evaluate(()=>window.kreoda.sessionPair());
    const fresh=new SessionClient();peers.push(fresh);
    await fresh.pair(url,rePair.token);
    const restored=await fresh.call("snapshot");
    expect(restored["revision"]).toBe(source.revision);
    expect((restored["features"] as {featureId:string}[]).some(f=>f.featureId===feature)).toBe(true);
    expect((await snapOf(page)).bodies.find(b=>b.id===feature)?.volumeMm3).toBeCloseTo(6000,2);
    await fresh.call("setSelection",{ids:[`${feature}:box.+X`],publish:true});
    await expect(page.getByTestId("shared-target-chip")).toContainText(`${feature}:box.+X`);
    expect((await snapOf(page)).revision).toBe(source.revision);
  } finally {
    for(const peer of peers)peer.closeRaw();
    await app.close();rmSync(profile,{recursive:true,force:true});
  }
});
