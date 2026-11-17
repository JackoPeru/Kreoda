# Quest Home MR worker evidence — 2026-10-20

## Scope and changes

Work was performed in `C:\Users\matte\Desktop\Saas\Kreoda-phase10-ci`. Existing dirty work outside the listed files was preserved.

- `QuestHome.cs`: added the floating center hero; replaced mislabeled QuickStart entries with `home:pc`, `home:project:select`, `home:project:open`, and `home:ai`; removed duplicate PC/task shelves; made offline and empty-server captions truthful and hid empty recent-project rows.
- `QuestHomeProjectData.cs`: exposed `HasRecentProjects`, `HasServerSnapshot`, and `RecentProjectCount` so rendering uses source state instead of inferring it from localized summary text.
- `QuestControls.cs`: passes explicit project-state flags; legacy new/import/template IDs now show Desktop ownership in the contextual notice. Navigating through Home first invalidates any pending thickness-notice reply. Initial CAD snapshot capture now happens after credential commit and `_client` publication, before the Connected notification, so `Update()` cannot discard the initial observation while `_client` is null.
- `QuestHomeTests.cs`: covers hero placement, real Home routes, empty/offline data, one PC status, all six lateral action hitboxes and labels, Desktop-owned notices, and invalidation of a pending thickness result.
- `QuestControlsTests.cs`: updated its one legacy Home route case to require the Desktop ownership notice.

No changes were made to `QuestPcCredentials.cs` or `QuestConnectionTests.cs`. The Quest connection change is one reorder of the initial `Capture` call plus its explanatory comment.

## Test evidence

All Unity runs used the pinned `6000.3.25f1` Editor, `-batchmode -nographics -buildTarget Android`, EditMode tests, and no `-quit` flag.

- Before the Home implementation, `QuestHomeTests` returned **23 total, 15 passed, 8 failed**. The failures matched the missing hero, duplicate statuses, offline rows, unsupported shortcuts, and missing Desktop notices. XML/log: `worker/red-home-tests.xml` and `.log`.
- The first combined Home/HUD/Controls/Environment/Connection run, before the initial-snapshot ordering fix, returned **105 total, 104 passed, 1 failed, 0 skipped**. `LostBootstrapAcknowledgementReusesPendingIdentityAfterRestart` timed out with `Scegli il PC dal nome`; its fixture output showed the expected dropped PC B bootstrap acknowledgement, followed by an `HttpRequestException` and subsequent discovery replies with zero peers. This run did not show credential crossover or a commit of B's credentials as A's.
- The same lost-ack test passed by itself (**1/1**) and passed in the pre-fix Connection-class run. That Connection-class run had **25/26 passed**; its unrelated `UsbBootstrapPairsAndReconnectsOverLoopbackWithActualMesh` failure reported `Connesso al PC` but `Views.Count == 0`.
- After moving initial capture behind commit and `_client` publication, the focused USB bootstrap/mesh test passed (**1/1**, 0 skipped, 1.74 s) and rendered the expected 264-triangle mesh. XML/log: `worker/autopair-usb-regression-01.xml` and `.log`.
- After the same fix, all `QuestConnectionTests` passed (**26/26**, 0 skipped). Both the lost-ack identity restart and USB mesh tests passed. XML/log: `worker/autopair-connection-suite-02.xml` and `.log`.
- `git diff --check` over the worker-owned C# files reported no whitespace errors.

The parent is running the final combined five-class suite after the snapshot-ordering fix. Its final XML/log and the actual Unity rendering/build/install evidence belong in the parent verification report; this worker report does not claim that combined run has completed.

## Preserved preimages

The three files added to the autopair review scope were copied before edits to `C:\Users\matte\Documents\Codex-tools\Native\quest-home-mr-20261020\worker`, recorded in `autopair-preimage-manifest.json`, and not changed by this worker:

- `QuestConnection.cs`: `EE6E27CE394AE133948A362E1C20FE3B5FD1AB75E3E954660D78447909148E29`
- `QuestConnectionTests.cs`: `9DB69B88D1C3125CF7878894F521D8D276849EFED62FAD4A426D22F2C4B0272A`
- `QuestPcCredentials.cs`: `17A278B9222BBD420E51F0E78AA2B037D539CDE125CDFC315E11EC8844D291C5`

The worker's Unity processes and QuestWireFixture processes have exited. The parent may now continue its final run and capture. No headset acceptance, Android package installation, or release is claimed here.
