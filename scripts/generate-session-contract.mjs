import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { quicktype, InputData, JSONSchemaInput, FetchingJSONSchemaStore } from "quicktype-core";
import Ajv from "ajv";
import standalone from "ajv/dist/standalone/index.js";
import { build } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
const check = process.argv.includes("--check");
const raw = await readFile(path.join(root, "schemas/session-control-v1.json"), "utf8");
const contract = JSON.parse(raw);
const hash = createHash("sha256").update(raw.replace(/\r\n/g, "\n")).digest("hex");
const header = `// Generated from schemas/session-control-v1.json. Do not edit.\n// Source SHA256: ${hash}\n`;
const definitions = contract.definitions;
const names = Object.keys(definitions);
const schema = { $schema: contract.$schema, $id: contract.$id, definitions };

async function dto(lang, rendererOptions) {
  const input = new JSONSchemaInput(new FetchingJSONSchemaStore());
  for (const name of names) await input.addSource({ name, schema: JSON.stringify({ ...schema, $ref: `#/definitions/${name}` }) });
  const inputData = new InputData(); inputData.addInput(input);
  return (await quicktype({ inputData, lang, rendererOptions })).lines.join("\n") + "\n";
}
const typescript = await dto("typescript", { "just-types": "true", "prefer-unions": "true" });
const csharp = await dto("csharp", { framework: "SystemTextJson", features: "attributes-only", namespace: "Kreoda.Session.Generated", "dateonly-timeonly-converters": "false" });
const methods = contract.methods;
const control = methods.filter(method => method.plane === "control").map(method => method.method);
const queries = methods.filter(method => method.plane === "query").map(method => method.method);
const replay = methods.filter(method => method.operationReplay).map(method => method.method);
const required = Object.fromEntries(methods.map(method => [method.method, method.required]));
const tsConst = (name, value) => `export const ${name} = ${JSON.stringify(value, null, 2)} as const;\n`;
const metadata = header + tsConst("CONTRACT_SCHEMA_SHA256", hash) + tsConst("SESSION_DTO_NAMES", names) + tsConst("SESSION_CONTROL_VERSION", contract.protocolVersion)
  + tsConst("CONTROL_METHODS", control) + tsConst("QUERY_METHODS_CONTRACT", queries)
  + tsConst("SESSION_CONTROL_METHODS", methods.map(method => method.method)) + tsConst("OPERATION_METHODS", replay)
  + `export const REQUIRED_PARAMS: Readonly<Record<string, readonly string[]>> = ${JSON.stringify(required, null, 2)};\n` + tsConst("SERVER_EVENTS", contract.serverEvents)
  + tsConst("SESSION_EVENT_METADATA", contract.serverEventMetadata);
const quote = value => JSON.stringify(value);
const csArray = values => "[" + values.map(quote).join(", ") + "]";
const csName = name => name[0].toUpperCase() + name.slice(1);
const csMetadata = header + `namespace Kreoda.Session;\n\npublic static class SessionMethods\n{\n`
  + `    public const int ProtocolVersion = ${contract.protocolVersion};\n    public const string ContractSchemaSha256 = "${hash}";\n    public const string OperationReplayCapability = "operation-replay";\n`
  + methods.map(method => `    public const string ${csName(method.method)} = ${quote(method.method)};`).join("\n")
  + `\n    public static readonly string[] All = ${csArray(methods.map(method => method.method))};\n`
  + `    public static readonly string[] OperationReplayMethods = ${csArray(replay)};\n`
  + `    public static bool SupportsOperationReplay(string method) => Array.IndexOf(OperationReplayMethods, method) >= 0;\n`
  + `    public static readonly IReadOnlyDictionary<string, string[]> RequiredParams = new Dictionary<string, string[]>\n    {\n`
  + methods.map(method => `        [${quote(method.method)}] = ${csArray(method.required)},`).join("\n") + "\n    };\n}\n"
  + `\npublic static class SessionContract\n{\n    public const long MaximumRevision = ${definitions.SessionSnapshotPayload.properties.revision.maximum};\n    public static readonly IReadOnlyDictionary<string, string[]> DtoRequiredFields = new Dictionary<string, string[]>\n    {\n`
  + names.map(name => `        [${quote(name)}] = ${csArray(definitions[name].required ?? [])},`).join("\n") + "\n    };\n}\n";

// Compile once during generation. Bundle the standard runtime helpers so
// Electron's renderer needs neither Ajv nor dynamic Function/eval at runtime.
const ajv = new Ajv({ allErrors: true, strict: true, code: { source: true } });
ajv.addSchema(schema);
const exports = {};
for (const name of names) {
  const id = `${contract.$id}#/definitions/${name}`;
  ajv.getSchema(id); exports[name] = id;
}
const bundled = await build({ stdin: { contents: standalone(ajv, exports), resolveDir: root, sourcefile: "session-validators.cjs" }, bundle: true, platform: "browser", format: "esm", write: false, legalComments: "none" });
const validators = "// @ts-nocheck\n" + header + bundled.outputFiles[0].text;
const outputs = new Map([
  ["packages/protocol/src/generated/session-dtos.ts", header + typescript],
  ["packages/protocol/src/generated/session-metadata.ts", metadata],
  ["packages/protocol/src/generated/session-validators.ts", validators],
  ["clients/session-dotnet/src/Kreoda.SessionClient/Generated/SessionDtos.g.cs", header + "#nullable enable annotations\n#nullable disable warnings\n" + csharp],
  ["clients/session-dotnet/src/Kreoda.SessionClient/Generated/SessionMethods.g.cs", csMetadata],
]);
let drift = false;
for (const [relative, contents] of outputs) {
  const filename = path.join(root, relative);
  if (check) {
    const existing = await readFile(filename, "utf8").catch(() => "");
    if (existing.replace(/\r\n/g, "\n") !== contents) { console.error("Generated contract drift: " + relative); drift = true; }
  } else { await mkdir(path.dirname(filename), { recursive: true }); await writeFile(filename, contents); }
}
if (drift) process.exitCode = 1;
else console.log(`${check ? "Verified" : "Generated"} ${outputs.size} session contract artifacts (${names.length} DTO schemas, source ${hash}).`);
