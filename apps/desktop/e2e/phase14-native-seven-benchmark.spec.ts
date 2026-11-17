import { test, expect, _electron as electron } from "@playwright/test";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { HERE, MAIN, hideForBackgroundE2E, openProject, runBar, snapOf } from "./helpers";

type NativeResult = {
  fixtureId: string; geometryPassed: boolean; accepted: false; failures: string[]; error?: string;
  commandCount: number; corrections: number; durationMilliseconds: number;
  finalFeatureId?: string; aliases: Record<string,string>; initialRevision: number; revision?: number;
  bounds?: { solidCount: number; volumeMm3: number; bboxMm: number[] };
};

const requirementsPath = path.resolve(HERE, "../../../docs/superpowers/benchmarks/phase14-requirements.json");
const frozenBytes=readFileSync(requirementsPath);
const requirementsSha256=createHash("sha256").update(frozenBytes.toString("utf8").replace(/\r\n/g,"\n")).digest("hex");
const ids = (JSON.parse(frozenBytes.toString("utf8")) as { fixtures: { id: string }[] }).fixtures.map(f => f.id);

test("Phase14 deterministic native seven-case OCCT baseline — evidence, not Hermes LLM signoff", async ({}, info) => {
  test.setTimeout(300_000);
  expect(ids).toHaveLength(7);
  const rows: Array<NativeResult & { saveOpen: boolean; editUndo: boolean; groupUndo: boolean; runtimeError?: string }> = [];
  const root = mkdtempSync(path.join(os.tmpdir(), "kreoda-native-seven-"));
  const selected=process.env.KREODA_NATIVE_BENCH_ONLY ? ids.filter(id=>id===process.env.KREODA_NATIVE_BENCH_ONLY) : ids;
  expect(selected.length, "KREODA_NATIVE_BENCH_ONLY must name a known fixture").toBeGreaterThan(0);
  for (const [index, id] of selected.entries()) {
    const profile = mkdtempSync(path.join(root, `fixture-${index}-`));
    const app = await electron.launch({ executablePath: createRequire(import.meta.url)("electron") as string,
      args: [MAIN, "--no-sandbox", "--lang=en-US", `--user-data-dir=${profile}`],
      env: { ...process.env, KREODA_SESSION_PORT:"", KREODA_SESSION_TOKEN:"", KREODA_RECOVERY_DIR:profile } });
    let bridge: ReturnType<typeof spawn> | undefined;
    let row: NativeResult & { saveOpen:boolean;editUndo:boolean;groupUndo:boolean;runtimeError?:string } = {
      fixtureId:id,geometryPassed:false,accepted:false,failures:["not-run"],commandCount:0,corrections:0,
      durationMilliseconds:0,aliases:{},initialRevision:0,saveOpen:false,editUndo:false,groupUndo:false,
    };
    try {
      const page = await app.firstWindow();await hideForBackgroundE2E(app);
      await expect.poll(() => page.evaluate(() => window.kreoda.coreInfo().then(i=>i.running))).toBe(true);
      const sessionPort = 44800 + index*2, bridgePort = sessionPort+1;
      await page.evaluate(port => window.kreoda.sessionEnable("127.0.0.1",port), sessionPort);
      const pairing = await page.evaluate(() => window.kreoda.sessionPair());
      const bridgeDll = path.resolve(HERE,"../../../clients/session-dotnet/tools/Kreoda.HermesBridge/bin/Release/net8.0/Kreoda.HermesBridge.dll");
      bridge = spawn("dotnet",[bridgeDll],{windowsHide:true,env:{...process.env,
        KREODA_HERMES_BRIDGE_URL:`http://127.0.0.1:${bridgePort}`,
        KREODA_CAD_SESSION_URL:`ws://127.0.0.1:${sessionPort}/`,KREODA_CAD_PAIR:pairing.token,
        KREODA_CAD_DEVICE_FILE:path.join(profile,"mcp-device.json"),KREODA_HERMES_CONFIG:"",KREODA_VOICE_TOKEN:"" }});
      await expect.poll(async()=>{try {return (await fetch(`http://127.0.0.1:${bridgePort}/health`)).ok;}catch{return false;}}).toBe(true);
      const probeDll = path.resolve(HERE,"../../../clients/session-dotnet/probes/Kreoda.McpProbe/bin/Release/net8.0/Kreoda.McpProbe.dll");
      const proof = await new Promise<NativeResult>((resolve,reject)=>{
        const child=spawn("dotnet",[probeDll],{windowsHide:true,env:{...process.env,
          KREODA_MCP_PROBE_SCENARIO:"native-seven-benchmark",KREODA_BENCHMARK_FIXTURE:id,
          KREODA_BENCHMARK_REQUIREMENTS:requirementsPath,KREODA_MCP_PROBE_URL:`http://127.0.0.1:${bridgePort}/mcp`}});
        let out="",err="";child.stdout.on("data",b=>out+=String(b));child.stderr.on("data",b=>err+=String(b));
        const timer=setTimeout(()=>{child.kill();reject(new Error("native fixture timeout"));},60000);
        child.once("error",reject);child.once("exit",code=>{clearTimeout(timer);if(code!==0)reject(new Error(err||out));
          else {try {resolve(JSON.parse(out.trim()));}catch(e){reject(e);}}});
      });
      row={...proof,saveOpen:false,editUndo:false,groupUndo:false};
      if (proof.geometryPassed && proof.finalFeatureId && proof.revision != null) {
        await expect.poll(async()=>(await snapOf(page)).revision).toBe(proof.revision);
        await expect.poll(async()=>(await snapOf(page)).bodies.find(b=>b.id===proof.finalFeatureId)?.volumeMm3)
          .toBeCloseTo(proof.bounds!.volumeMm3,2);
        if (await page.getByTestId("home-new-project").isVisible()) await page.getByTestId("home-new-project").click();
        await runBar(page,"undo");
        await expect.poll(async()=>(await snapOf(page)).bodies.length).toBe(0);
        row.groupUndo=true;
        await runBar(page,"redo");
        await expect.poll(async()=>(await snapOf(page)).bodies.find(b=>b.id===proof.finalFeatureId)?.volumeMm3)
          .toBeCloseTo(proof.bounds!.volumeMm3,2);
        const archive=path.join(profile,"fixture.icad");
        await page.evaluate(file=>(window as unknown as {__kreoda_test:{saveIcad:(p:string)=>Promise<unknown>}}).__kreoda_test.saveIcad(file),archive);
        await page.evaluate(file=>(window as unknown as {__kreoda_test:{openIcad:(p:string)=>Promise<unknown>}}).__kreoda_test.openIcad(file),archive);
        await expect.poll(async()=>(await snapOf(page)).bodies.find(b=>b.id===proof.finalFeatureId)?.volumeMm3)
          .toBeCloseTo(proof.bounds!.volumeMm3,2);
        row.saveOpen=true;
        if (await page.getByTestId("home-new-project").isVisible()) await page.getByTestId("home-new-project").click();
        await openProject(page);
        const editable = proof.aliases.profile || proof.aliases.outer || proof.aliases.base;
        if (editable) {
          await page.getByTestId(`object-tree-${editable}`).click();
          // Edit only if the selected source has an established canonical scalar dimension.
          const dimension=id==="chamfered-shaft" || id==="six-hole-flange" ? "radiusMm" : proof.aliases.profile ? "distanceMm" : proof.aliases.outer ? "distanceMm" : "widthMm";
          if (dimension==="distanceMm" && proof.aliases.profile)
            await page.getByTestId(`object-tree-${proof.aliases.blank ?? proof.aliases.result}`).click();
          await runBar(page,dimension==="widthMm"?"set widthMm 110":dimension==="radiusMm"?`set radiusMm ${id==="six-hole-flange"?51:11}`:"set distanceMm 45");
          await expect.poll(async()=>(await snapOf(page)).revision).toBeGreaterThan(proof.revision!);
          await expect.poll(async()=>{
            const changed=(await snapOf(page)).bodies.find(b=>b.id===proof.finalFeatureId)?.volumeMm3;
            return typeof changed==="number" && Math.abs(changed-proof.bounds!.volumeMm3)>.01;
          }).toBe(true);
          await runBar(page,"undo");
          await expect.poll(async()=>(await snapOf(page)).bodies.find(b=>b.id===proof.finalFeatureId)?.volumeMm3)
            .toBeCloseTo(proof.bounds!.volumeMm3,2);
          row.editUndo=true;
        }
      }
    } catch (e) {row.runtimeError=e instanceof Error?e.message:String(e);row.failures.push("host-or-e2e-failed");}
    finally {bridge?.kill();await app.close();}
    rows.push(row);
  }
  const report={schemaVersion:1,kind:"deterministic-native-baseline-not-Hermes-LLM",
    frozenRequirements:requirementsPath,requirementsSha256,fixtures:rows,
    geometryPassCount:rows.filter(r=>r.geometryPassed).length,
    fullyCheckedCount:rows.filter(r=>r.geometryPassed&&r.groupUndo&&r.saveOpen&&r.editUndo).length,
    commandAttempts:rows.reduce((n,r)=>n+r.commandCount,0),
    repairAttempts:rows.reduce((n,r)=>n+r.corrections,0),
    elapsedMilliseconds:rows.reduce((n,r)=>n+r.durationMilliseconds,0),
    meetsSixOfSeven:rows.filter(r=>r.geometryPassed&&r.groupUndo&&r.saveOpen&&r.editUndo).length>=6,
    externalHermesCalled:false};
  const reportPath=path.join(root,"native-seven-report.json");
  writeFileSync(reportPath,JSON.stringify(report,null,2));
  await info.attach("native-seven-report",{path:reportPath,contentType:"application/json"});
  const failedRows=rows.filter(r=>!r.geometryPassed||!r.groupUndo||!r.saveOpen||!r.editUndo||Boolean(r.runtimeError));
  console.log("NATIVE_SEVEN_BENCHMARK "+JSON.stringify({geometry:report.geometryPassCount,fullyChecked:report.fullyCheckedCount,
    failures:failedRows.map(r=>({id:r.fixtureId,reason:r.error||r.runtimeError||r.failures.join(","),
      geometryPassed:r.geometryPassed,groupUndo:r.groupUndo,saveOpen:r.saveOpen,editUndo:r.editUndo}))}));
  expect(rows).toHaveLength(selected.length);
  expect(failedRows,"Every selected native fixture must pass geometry, grouped Undo, Save/Open and edit/Undo").toEqual([]);
});
