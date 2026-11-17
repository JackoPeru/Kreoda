import hashlib,json,os,shutil,subprocess,xml.etree.ElementTree as ET
from collections import Counter
from pathlib import Path
root=Path('C:/Users/matte/Desktop/Saas/Kreoda-phase10-ci')
qa=Path(__file__).parent
prior=Path('C:/Users/matte/Documents/Codex-tools/Native/phase15-repair-schema-parent-20261016')
pwsh='C:/Users/matte/.cache/codex-runtimes/codex-primary-runtime/dependencies/native/powershell/pwsh.exe'
summary={}
startup=subprocess.STARTUPINFO();startup.dwFlags|=subprocess.STARTF_USESHOWWINDOW;startup.wShowWindow=subprocess.SW_HIDE
def save(): (qa/'summary.json').write_text(json.dumps(summary,indent=2))
def hashes():
 paths=subprocess.check_output(['git','ls-files','--cached','--others','--exclude-standard'],cwd=root,text=True).splitlines()
 return {p:hashlib.sha256((root/p).read_bytes()).hexdigest() for p in sorted(set(paths)) if p.startswith(('apps/desktop/','packages/','clients/','schemas/','scripts/')) and not p.startswith('clients/quest-unity/') and (root/p).is_file()}
def run(args,name,cwd=root,env=None):
 with (qa/(name+'.log')).open('wb') as out:
  r=subprocess.run(args,cwd=cwd,env=env,stdout=out,stderr=subprocess.STDOUT,startupinfo=startup,creationflags=subprocess.CREATE_NO_WINDOW,timeout=1200)
 summary[name+'ExitCode']=r.returncode;save()
 if r.returncode: raise SystemExit(name+' failed')
def ps(cmd,name):run([pwsh,'-NoProfile','-Command',cmd+'; exit $LASTEXITCODE'],name)
def junit(name,minimum,old=None):
 tree=ET.parse(qa/(name+'.xml'));cases=tree.findall('.//testcase')
 result={'cases':len(cases),'failed':len(tree.findall('.//failure'))+len(tree.findall('.//error')),'skipped':len(tree.findall('.//skipped'))}
 if old:
  previous=ET.parse(old).findall('.//testcase')
  key=lambda c:(c.get('classname',''),c.get('name',''))
  missing=Counter(map(key,previous))-Counter(map(key,cases));result['lostPreviousOccurrences']=sum(missing.values())
 summary[name]=result;save()
 if len(cases)<minimum or result['failed'] or result['skipped'] or result.get('lostPreviousOccurrences',0):raise SystemExit(name+' discovery/result failure')
before=hashes();(qa/'source-before.json').write_text(json.dumps(before,indent=2))
for pkg in ['protocol','command-schema']:
 for action in ['build','lint']:ps('pnpm --filter @kreoda/'+pkg+' '+action,pkg+'-'+action)
ps('pnpm check:session-contract','session-contract')
for pkg,name,minimum,priorfile in [('protocol','protocol',56,prior/'protocol.xml'),('command-schema','canonical',15,prior/'canonical.xml'),('desktop','desktop',287,None)]:
 ps('pnpm --filter @kreoda/'+pkg+' exec vitest run '+('src ' if pkg=='command-schema' else '')+"--reporter=junit --outputFile='"+str(qa/(name+'.xml'))+"'",name)
 junit(name,minimum,priorfile)
ps('pnpm --filter @kreoda/desktop build','desktop-build')
ps('pnpm --filter @kreoda/desktop lint','desktop-lint')
run([shutil.which('dotnet'),'build',str(root/'clients/session-dotnet/Kreoda.Session.sln'),'-c','Release','-p:Platform=Any CPU'],'managed-solution-build')
ns={'t':'http://microsoft.com/schemas/VisualStudio/TeamTest/2010'};summary['managedSuites']={}
for name,proj,minimum in [('SessionClient','Kreoda.SessionClient.Tests',142),('ModelingAgent','Kreoda.ModelingAgent.Tests',33),('HermesBridge','Kreoda.HermesBridge.Tests',34),('ModelingBenchmark','Kreoda.ModelingAgent.Benchmark.Tests',33)]:
 run([shutil.which('dotnet'),'test',str(root/'clients/session-dotnet/tests'/proj/(proj+'.csproj')),'-c','Release','--no-build','--logger','trx;LogFileName='+name+'.trx','--results-directory',str(qa/'dotnet')],'managed-'+name)
 tests=ET.parse(qa/'dotnet'/(name+'.trx')).findall('.//t:UnitTestResult',ns)
 old=ET.parse(prior/'dotnet'/(name+'.trx')).findall('.//t:UnitTestResult',ns)
 normalize_name=lambda n:n.replace('ControlMessagesAreCappedAtFourMiBBeforeBufferGrowth','ControlMessagesAreCappedAt64MiBBeforeBufferGrowth')
 missing=Counter(normalize_name(t.get('testName','')) for t in old)-Counter(t.get('testName') for t in tests)
 result={'cases':len(tests),'notPassed':[t.get('testName') for t in tests if t.get('outcome')!='Passed'],'lostPreviousOccurrences':sum(missing.values())}
 if name=='SessionClient':
  required=['TypedQueryCapturesRevisionAndOlderFailureCannotClearNewerSuccess','LatestQueryFailureClearsExistingProjectionDisplay','DocumentSwitchRejectsLateReplyWhenNativeIdsAndGenerationAreReused','CoreRestartClearsProjectionStateBeforeSnapshotWithReusedIdsAndGeneration','TypedQueryEnforcesUnicodeEntityAndExactDefinitionByteLimits','StaleFailedRequestCannotClearNewerSuccessfulDisplay','ClearingLineageInvalidatesBothDisplayAndInFlightRequestToken','ClearDoesNotLetDelayedPublishReuseANewerRequestToken','ClearDoesNotLetDelayedFailureCleanupEraseANewerDisplay','ProjectionGroupsSurviveValidSketchDeltasAndInvalidUtf8OrDefinitionsRequireRecovery','ControlMessagesAreCappedAt64MiBBeforeBufferGrowth']
  result['missingRequired']=[case for case in required if not any(t.get('testName','').endswith('.'+case) for t in tests)]
  if result['missingRequired']:raise SystemExit('Required managed projection cases missing: '+str(result['missingRequired']))
 summary['managedSuites'][name]=result;save()
 if len(tests)<minimum or result['notPassed'] or missing:raise SystemExit(name+' discovery/result failure')
e2e_env=dict(os.environ)
e2e_env['KREODA_BACKGROUND_TEST']='1'
e2e_env['PLAYWRIGHT_JUNIT_OUTPUT_FILE']=str(qa/'native-mcp-e2e.xml')
run([pwsh,'-NoProfile','-Command','pnpm --filter @kreoda/desktop exec playwright test e2e/phase16-projection-mcp.spec.ts --workers=1 --reporter=junit; exit $LASTEXITCODE'],'native-mcp-e2e',env=e2e_env)
junit('native-mcp-e2e',1)
after=hashes();(qa/'source-after.json').write_text(json.dumps(after,indent=2));summary['sourceFiles']=len(before);summary['sourceUnchanged']=before==after;save()
if before!=after:raise SystemExit('Source changed during parent verification')
print(json.dumps(summary))
