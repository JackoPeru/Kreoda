# Quest keyboard input correction - 10 October

User confirmed prior panel readability, eye-level placement and header drag. The later connection claim did not match the PC: zero clients/devices. User then confirmed PC non connesso and an empty code field after closing the keyboard. Do not treat earlier visual confirmation as authenticated CAD rendering.

QuestControls previously retained text only on TouchScreenKeyboard.Done. ApplyKeyboardInput now captures live Visible/Done and nonempty closing text; empty LostFocus/Canceled retains the draft, while Done with empty text clears it deliberately. IP input is trimmed. Dismissing the keyboard changes a field only; Connetti remains the explicit validated association action. No code/credentials are persisted or logged by this fix.

Verification: meaningful RED3/25, then dismissal/explicit-clear RED2/26, final actual Unity26/26 directexit0. QA phase12-root-keyboard-final-green-20261010. Fresh reviewer01a1265b-a30f-75c0-9731-b867fbcc653b actualgpt-6-sol/high returnedSHIP for Unity keyboard diff only. All764 source inputs unchanged before build/review and after, manifestSHA b85067c3f07cc30d709035b427d5516a337587bc59b6bfe9c964293be53a3348. Hostdanger-full-access/profiledisabled; behavioral read-only, not enforced isolation. Independent nativePhase13Task2WIP excluded from review and not bundled as a CAD kernel on Quest.

Normal populated ARM64 IL2CPP APK36,116,086bytes SHA9f04a1c21c9e7dec54ce36c690f304200e13f7c15ce15dde0156a48526cfd46e, directUnity0/105.864sec, BuildReportSucceeded0errors6warnings, sourceChangedDuringBuild[]. OnlyInternet/HandTracking permissions; noOperator/MediaProjection ZIP entries. InstalledSuccess/launchedQuestPID5691. Actual hardware keyboard/connection retest pending.

Actual PC app.getPath(userData) inspected through its owned main Node inspector equals the isolated quest-audit-user-data directory. Hidden production PC uses real saved/reopened100x50x20mm CADrev1. No headset screenshot/camera capture. Exact hostedfb0010238058087544 andf9330aa38060846833 bothSUCCESS; new keyboard head hosted pending commit/push. Phase12 physical11steps and fullPhases13-16 remain incomplete.
