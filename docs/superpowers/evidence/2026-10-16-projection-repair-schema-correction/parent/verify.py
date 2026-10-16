import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import xml.etree.ElementTree as ET

root = Path('C:/Users/matte/Desktop/Saas/Kreoda-phase10-ci')
qa = Path(__file__).parent
build = Path('C:/Users/matte/Documents/Codex-tools/Native/phase15-projection-kernel-20261015/build')
previous = Path('C:/Users/matte/Documents/Codex-tools/Native/phase15-lifecycle-owner-delete-parent-20261015')
pwsh = 'C:/Users/matte/.cache/codex-runtimes/codex-primary-runtime/dependencies/native/powershell/pwsh.exe'
required = set(json.loads((previous / 'summary.json').read_text())['requiredCases'])
required.update({
    'SketchProjectionPublicWire.DispatchesAndSamplesCurvedGeometryReadOnly',
    'SketchProjectionPublicWire.HidesCachedEdgesWhenSourceClosureIsUnavailable',
    'SketchProjectionPublicWire.SerializesLineEdgesWithTwoWorldSpaceEndpoints',
    'SketchProjectionPublicWire.ValidatesErrorsAndJoinsOwnerTransaction',
})
required.update({
    'SketchProjectionRecovery.RepairsTwoBrokenGroupsWithoutPublishingStaleGeometry',
    'SketchProjectionRecovery.RemovesOneBrokenGroupAndLastProfileRemovalIsAtomic',
    'SketchProjectionRecovery.AggregateOverflowCannotBreakALaterHealthyGroup',
    'SketchProjectionRecovery.TaintedJoinedRepairRestoresBothBrokenGroups',
    'SketchProjectionRecovery.TwoGroupRepairInOneTransactionHasOneUndo',
})
wire = Path('C:/Users/matte/Documents/Codex-tools/Native/phase15-public-wire-parent-20261016')
previous_paths = set(json.loads((wire / 'source-before.json').read_text()))
summary = {'expectedNativeCases': 284, 'expectedProtocolCases': 56,
           'expectedCanonicalCases': 15, 'expectedManagedCases': 242}
startup = subprocess.STARTUPINFO()
startup.dwFlags |= subprocess.STARTF_USESHOWWINDOW
startup.wShowWindow = subprocess.SW_HIDE

def source_hashes():
    changed = subprocess.check_output(['git', 'diff', '--name-only'], cwd=root, text=True).splitlines()
    new = subprocess.check_output(['git', 'ls-files', '--others', '--exclude-standard'], cwd=root, text=True).splitlines()
    paths = previous_paths | {p for p in changed + new if p.startswith(('native/', 'packages/', 'clients/', 'schemas/', 'scripts/'))}
    return {p: hashlib.sha256((root / p).read_bytes()).hexdigest() for p in sorted(paths)}

def save_summary():
    (qa / 'summary.json').write_text(json.dumps(summary, indent=2))

def run(args, name, cwd=root, env=None):
    with (qa / (name + '.log')).open('wb') as output:
        result = subprocess.run(args, cwd=cwd, env=env, stdout=output,
            stderr=subprocess.STDOUT, startupinfo=startup,
            creationflags=subprocess.CREATE_NO_WINDOW, timeout=900)
    summary[name + 'ExitCode'] = result.returncode
    save_summary()
    if result.returncode:
        raise SystemExit(name + ' failed; see parent log')

def ps(command, name):
    run([pwsh, '-NoProfile', '-Command', command + '; exit $LASTEXITCODE'], name)

def junit(name, expected, required_names=()):
    tree = ET.parse(qa / (name + '.xml'))
    cases = tree.findall('.//testcase')
    names = {case.get('name', '') for case in cases}
    result = {'cases': len(cases), 'failed': len(tree.findall('.//failure')) + len(tree.findall('.//error')),
              'skipped': len(tree.findall('.//skipped')), 'missingRequired': sorted(set(required_names) - names)}
    summary[name] = result
    save_summary()
    if len(cases) != expected or result['failed'] or result['skipped'] or result['missingRequired']:
        raise SystemExit(name + ' discovery/result gate failed')

cache = (build / 'CMakeCache.txt').read_text()
for setting in ('WITH_OCCT:BOOL=ON', 'WITH_FLATBUFFERS:BOOL=ON', 'KREODA_ALLOW_STUB_CORE:BOOL=OFF', 'KREODA_CRASH_TEST_BARRIERS:BOOL=OFF'):
    if setting not in cache.splitlines():
        raise SystemExit('Wrong native build setting: ' + setting)
before = source_hashes()
(qa / 'source-before.json').write_text(json.dumps(before, indent=2))
run([shutil.which('cmake'), '--build', str(build), '--config', 'Release',
     '--target', 'kreoda-core', 'kreoda-core-tests', '--parallel', '2'], 'native-build')
run([shutil.which('ctest'), '--test-dir', str(build), '-C', 'Release',
     '--output-on-failure', '--no-tests=error', '--output-junit', str(qa / 'native.xml')], 'native')
junit('native', 284, required)
system_root = os.environ.get('SystemRoot', 'C:/Windows')
restricted = {**os.environ, 'PATH': str(Path(system_root) / 'System32') + ';' + system_root}
run([str(build / 'Release/kreoda-core.exe'), '--self-test'], 'core-self-test', build / 'Release', restricted)
summary['restrictedPathSelfTest'] = 'kreoda-core self-test OK' in (qa / 'core-self-test.log').read_text()
if not summary['restrictedPathSelfTest']:
    raise SystemExit('Self-test confirmation missing')
ps('pnpm --filter @kreoda/protocol build', 'protocol-build')
ps('pnpm --filter @kreoda/command-schema build', 'canonical-build')
ps('pnpm --filter @kreoda/protocol lint', 'protocol-lint')
ps('pnpm --filter @kreoda/command-schema lint', 'canonical-lint')
ps('pnpm check:session-contract', 'session-contract')
ps("pnpm --filter @kreoda/protocol exec vitest run --reporter=junit --outputFile='" + str(qa / 'protocol.xml') + "'", 'protocol')
junit('protocol', 56)
ps("pnpm --filter @kreoda/command-schema exec vitest run src --reporter=junit --outputFile='" + str(qa / 'canonical.xml') + "'", 'canonical')
junit('canonical', 15)
probe = '''import { SketchProjectionSourceSchema, SketchProjectionGroupResultSchema } from './packages/protocol/dist/index.js';
const source = {type:'edge',featureId:'source',persistentEdgeId:'source:'+'é'.repeat(300)};
const group = {groupId:'group',definition:{version:1,operation:'projectEdges',sources:[source]},sourceFeatureIds:['source'],status:'ok',error:'',blockingSourceIds:[],generation:1,edges:[]};
const result = {utf8Bytes:new TextEncoder().encode(source.persistentEdgeId).length,standaloneAccepts:SketchProjectionSourceSchema.safeParse(source).success,nestedAccepts:SketchProjectionGroupResultSchema.safeParse(group).success,validUnicodeAccepted:SketchProjectionSourceSchema.safeParse({...source,persistentEdgeId:'source:'+'é'.repeat(200)}).success};
console.log(JSON.stringify(result)); if(result.standaloneAccepts||result.nestedAccepts||!result.validUnicodeAccepted)process.exit(1);'''
run([shutil.which('node'), '--input-type=module', '-e', probe], 'protocol-utf8-probe')
summary['utf8Probe'] = json.loads((qa / 'protocol-utf8-probe.log').read_text())
run([shutil.which('dotnet'), 'build', str(root / 'clients/session-dotnet/Kreoda.Session.sln'),
     '-c', 'Release', '-p:Platform=Any CPU'], 'managed-solution-build')
ns = {'t': 'http://microsoft.com/schemas/VisualStudio/TeamTest/2010'}
summary['managedSuites'] = {}
total = 0
for name, project, expected in [
    ('SessionClient', 'Kreoda.SessionClient.Tests', 142),
    ('ModelingAgent', 'Kreoda.ModelingAgent.Tests', 33),
    ('HermesBridge', 'Kreoda.HermesBridge.Tests', 34),
    ('ModelingBenchmark', 'Kreoda.ModelingAgent.Benchmark.Tests', 33),
]:
    run([shutil.which('dotnet'), 'test', str(root / 'clients/session-dotnet/tests' / project / (project + '.csproj')),
         '-c', 'Release', '--no-build', '--logger', 'trx;LogFileName=' + name + '.trx',
         '--results-directory', str(qa / 'dotnet')], 'managed-' + name)
    tree = ET.parse(qa / ('dotnet/' + name + '.trx'))
    results = tree.findall('.//t:UnitTestResult', ns)
    result = {'cases': len(results), 'notPassed': [c.get('testName') for c in results if c.get('outcome') != 'Passed']}
    if name == 'SessionClient':
        result['projectionRoundTripPresent'] = any(c.get('testName', '').endswith('ProjectionDisplayDtosRoundTripTheContractedWireShape') for c in results)
        if not result['projectionRoundTripPresent']:
            raise SystemExit('Missing managed projection round-trip')
    summary['managedSuites'][name] = result
    save_summary()
    if len(results) != expected or result['notPassed']:
        raise SystemExit(name + ' discovery/result gate failed')
    total += len(results)
summary['managedTotal'] = total
after = source_hashes()
(qa / 'source-after.json').write_text(json.dumps(after, indent=2))
summary['sourceFiles'] = len(before)
summary['sourceUnchanged'] = before == after
save_summary()
if total != 242 or not summary['sourceUnchanged']:
    raise SystemExit('Managed or immutable-source gate failed')
print(json.dumps(summary))
