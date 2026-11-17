# Hermes MCP and Quest voice source verification

Hermes retains planning, memory and its tool loop. The new official MCP SDK bridge uses the canonical authenticated CAD session and PC command schemas. It exposes project context, read-only introspection and owned bounded transactions with immutable goal checks, actual B-Rep/measurement validation and one Undo group. Creation counts come from the canonical registry; StableFeatureId export comes from the generated canonical JSON definition rather than an opaque Zod custom export. Voice uses actual Hermes runs, durable submission identity, persisted conversation IDs and the resident STT/TTS services.

Voice scope checks the Quest document/revision, requires the originating voice ID for CAD, rejects foreign/late origins, rolls back unfinished voice work and retains action/feature/correction budgets and original checks across corrections. Known run cancellation calls the actual stop endpoint. Cancellation before a lost submission acknowledgement has a recorded unknown-run boundary; no fake stop success or new mutating turn is claimed.

Quest records only on Parla, sends on Invia, plays segmented reply audio sequentially and cancels microphone/network/owned audio/late callbacks on Stop/focus/tracking/disable. Private startup configuration is consumed and stored in app-private storage; the Hermes key remains on the PC. Text snippets are bounded with rich text disabled. RECORD_AUDIO is declared; actual permission grant and new installation are pending.

## Parent evidence

- Managed actual net8 and actual netstandard2.1 libraries125/125 each, direct0; includes bounded PCM16/float32 and voice HTTP cancellation/error checks.
- Helper33/33 and bridge19/19; official MCP HTTP client discovery/resource access, actual wire shapes, goal failure/ownership/expiry, same-operation commit recovery, durable submission recovery and voice ownership/budget checks.
- Full JS276 (2+4+49+14+207), lint and generated-contract drift exit0.
- Unity43/43, direct0,30.855s at externalQA phase14-hermes-voice-updated-green-20261011. Real REDs covered absent voice scene wiring and overlapping Parla/Undo controls. Physics transform synchronization corrected the harness before the real overlap was diagnosed and fixed. No microphone used by Editor tests.
- Actual official MCP/Electron/OCCT8.0.1 proof passed1: canonical box100x50x20, measured100000mm3, verified commit and one Desktop Undo restored an empty document. Integration initially rejected missing client-UUID prefix and opaque ID-array JSON Schema; both fixed at their respective shared boundaries. ExternalQA phase14-hermes-mcp-native-final-20261011.
- Actual synthetic server TTS to STT:3.2135s,117804B WAV; transcript recognizes the test phrase. No user microphone capture or PC playback. External kreoda-hermes-integration-20261011/synthetic-voice-proof.json.
- Normal ARM64 APK build direct0,184.313s, SHA7b0c00f5375473aeaa7a8b8ab4b51bad849534678fd0ca5647532b65448201f0. Build input report changes only the newly added documentation docs/HERMES_MCP_VOICE.md; no executable APK inputs changed during build. Do not describe the whole manifest as unchanged.

The new source is not deployed or registered in Hermes yet. Live agent discovery/project awareness/conversation continuity, complete voice flow, updated installed headset package and live modeling benchmark remain pending. Physical headset usability and full Phase13 acceptance are not inferred. Full Phases14-16 remain active. Original Luna helper task for this new request failed terminally on quota after33 helpers; parent resumed implementation under explicit user fallback, without worker retries.

## Review correction gate

First fresh Sol6/high review returned fix-first: untrusted exported startup extras and unused iteration limit. Both corrected. Voice and CAD startup configuration accept only the Android DUMP-protected AdbProvisioning alias. Public launch preserves saved configuration. Actual Quest shell DUMP permission verified. CAD command attempts now consume the shared iteration budget before socket mutation; correction cannot reset it. Meaningful REDs retained, bridge20/20 and Unity45/45 direct0 after correction. Fresh review and corrected APK remain pending.

## Actual internal integration

Corrected normal ARM64 APK built direct0 in79.72s with zero source changes, SHA7495c0f88680fb63eefb13bf1698288bc3ee0c03b1940b575b370d07556dcc1a. Installed via ADB, microphone permission granted, protected alias launch after force-stop. Native Desktop session reports both agent and Quest clients connected. Guardian pause restored0 and simulated proximity released. Physical mic quality/voice button playback remains unproven; no user audio or headset capture performed.

PC model preserved through Save/Open with identical feature IDs and100/50/20 dimensions. Current companion hidden; published bridge binds loopback9843, remote SSH reverse19843. Hermes config backed up, unrelated parsed settings preserved on registration; added kreoda MCP and native kreoda-agent model route with16 native iterations and kreoda/memory toolsets. Native Hermes reports custom Qwen3.8-27B-Uncensored-EXL3-3.07bpw model_routes runtime. Server initially had no loaded model; existing Tabby configuration reloaded without changing its values. Native project-context/model response correctly reports actual volume and dimensions. Synthetic question TTS→STT→Hermes→answerTTS took6.065s and retained native conversation ID. Separate native Hermes skill file added; GET skills has existing adapter keyword drift(include_editorial), so API listing is not claimed successful. Persistent memory request still pending at this checkpoint.

Fresh corrected Sol6/high reviewer started with actual broader permissions observed(behavioral read-only). It terminated on quota before a verdict.849 source hashes unchanged during that audit. No fresh ship verdict, acceptance commit, push or release is claimed. All source remains WIP; full Phase14 benchmark, Phase13 physical acceptance and Phases15–16 remain required.

## Second review and real-agent compatibility correction

Fresh Sol6/high final review returned fix-first: assigning an owned request before constructing its deadline could leave LOCKED state if expiry occurs during catalog load. Meaningful RED reproduced the leaked LOCKED response; deadline is now created before assignment and unused expiry source disposed on failure. Remaining duration sampled once. Full bridge22/22 after additional object-schema and timeout tests.

Actual agent mutation attempt failed on Hermes argument coercion of a boolean JSON Schema property and timed out. No model change survived; transaction cleared,100/50/20 and original feature ID independently verified. Remote runtime patch attempt could not write immutable release; before/after runtime hashes match exactly. Fixed our interface instead: query/command parameters are typed dictionaries, accurately declaring required object shape. Official SDK schema RED→GREEN; the real unchanged Hermes coerce_tool_args and handle_function_call now successfully fetch the14824-byte canonical CAD command schema. Owned operation deadlines and voice upstream timeouts now produce bounded typed504 errors without claiming rollback of previously committed changes. Corrected real-agent edit rerun pending at this checkpoint.

Native Hermes memory entry for Kreoda verified on disk; a test-turn-only no-mutation phrase mistakenly copied into our new entry was removed with backup, unrelated entries preserved. Fresh native conversation outside Kreoda correctly described project, Quest and STT/TTS bridge. The memory-write HTTP itself timed out, so no successful response claimed. Old direct-model SSH tunnel removed after PID/arguments verified; only actualHermes integration remains.

## Actual Hermes mutation and final envelope correction

Second realagent attempt exposed NamedCommandParams rejecting featureId:null for edits. Corrected envelope omits IDs unless allocated; edits retain actual target ID in parameters. MeaningfulSDKvalidation RED→GREEN. Actual MCP→OCCT SetDimension nowcommits120×50×20/volume120000 withsamefeatureID; oneDesktopUndo restores100×50×20. Third actualHermes attempt completedHTTP200 throughnativeMCP tools withvalidatedB-Rep/check volume120000, dimensions independentlyread fromPC; oneDesktopUndo restoredoriginalfeature/parameters. All earlierfailedattempts retained; these smokeproofs do notreplace7promptbenchmark.

A furthermetadataedge: single-item ID-array commands previouslyregistered a null alias. RED expecteddeclaredID/actualnull; fixedalias/reporting usesvalidateddeclaredID whileomittingunallocatedenvelopeID. Fixture initiallylackedrequiredID-array schema; repairedfixture andreran genuineRED beforeGREEN. Fullbridge24/24 direct0. Previousfreshship covered22-test source andwasinvalidatedbysubsequentcorrections; newfreshfinalreviewrequired. Noacceptancecommit/releaseclaimed.

## Unconfirmed rollback gate

Fresh read-only Sol6/high review rejected swallowed rollback errors that could return validation_failed/cancelled despite a broker orphan. MeaningfulRED reproduced false cancelled status after actualsocket error. Corrected: explicituncertain outcome and recoveryidentity, newworkfence, privateatomicrecoverypersistence/restartfence, voice cleanupwithoutfalseack, and recordedidleexpiryfailure. Fullbridge27/27direct0, includingfailedvalidationrollback, cancellation, idleexpiry andrestart. Priorreviewverdictinvalidated; freshfinalreviewrequired beforeacceptance. OrdinaryactualHermesedit andUndo proof remains valid forunchanged successfulpath; physicalvoice and7benchstillpending.

## Final internal software acceptance

Fresh actualSol6/high reviewer01a12cf3-faee-7c31-a62f-3d7905a1272e returnedship forinternalsoftware, behaviorallyread-only(actualdanger-full-access/disabledprofile). All850frozeninputsunchanged before/after SHA b02a7dcd4fa0c568351feed8b41ea80ab5d3118bcc1184b680220fc86635b5ea. Final27-testbridge published/runshidden; health andactualMCPdescribe returnrestored100/50/20/volume100000. No physicalQuestvoice,7-benchmark,fullPhase13or15–16 completionclaimed. Newhelper/bridgegatesranlocally; existinghostedsolutionrunnerdoesnotyetinclude those newtestprojects, so do notclaimhostedcoverageofthem. FollowupbenchmarkpacketmustintegrateCIcoverage.
