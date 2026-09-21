# INTENT-CAD — Revised Post-Phase-9 Roadmap
## Validation, Unified Session Core, Quest Spatial Client, Autonomous Agent, Advanced CAD, Intent Modeling

> **Purpose**
>
> This roadmap supersedes the previous post-V1 roadmap.
>
> It is designed to start **after the currently-running autonomous Phase 9** already created by the coding agent.
>
> The currently-running Phase 9 may contain slices such as:
>
> - Phase 9a — Parametric expressions
> - Phase 9b — Sandboxed plugin system
> - Phase 9c — Create from Reference, Stage A
> - Phase 9d — Rigid assemblies
> - any additional Phase 9 slices already planned by the agent
>
> Do **not** restart, rename, or duplicate those slices.
>
> Complete the current Phase 9 first, produce its completion report, then begin this roadmap at **Phase 10**.
>
> This roadmap intentionally contains **no CAM / Manufacturing phase**. CAM is out of scope until explicitly reintroduced in a future specification.

---

# 0. Product direction

The application is no longer considered only a desktop CAD.

The target architecture is:

```text
                         AUTHORITATIVE CAD CORE
                         OCCT / OCAF / Feature DAG
                                  │
                         CAD Session Service
                                  │
                 ┌────────────────┼────────────────┐
                 │                │                │
                 ▼                ▼                ▼
            Desktop Client    Quest Client      AI Agent
          React / Three.js     Unity / MR       Headless
          Mouse/Keyboard       Hands/Voice      Semantic API
```

All clients operate on:

```text
the same document
the same feature graph
the same parametric model
the same persistent topology
the same undo/redo history
the same authoritative B-Rep
```

There must never be:

```text
Desktop CAD project
+
separate Quest copy
+
manual export/import synchronization
```

The desired experience is:

```text
Create or edit on PC
        ↓
Put on Quest
        ↓
The same model is already present
        ↓
Modify it spatially in MR/VR
        ↓
Desktop updates in the same session
        ↓
Remove Quest
        ↓
Continue immediately on PC
```

---

# 1. Revised roadmap

```text
CURRENT
Phase 9   Agent-created feature completion                [IN PROGRESS]

NEXT
Phase 10  Validation & Release Candidate
Phase 11  Unified CAD Session Service + Semantic Control API
Phase 12  Quest Spatial Client Foundation
Phase 13  Quest Spatial Interaction & MR UX
Phase 14  Autonomous Modeling Agent
Phase 15  Advanced CAD
Phase 16  Intent / Generative Modeling
```

There is deliberately **no Manufacturing/CAM phase** in this roadmap.

---

# 2. Global non-negotiable rules

These apply to every phase.

## 2.1 Canonical model remains on the CAD core

The authoritative geometry remains:

```text
OCCT B-Rep
+
OCAF document
+
feature graph
+
persistent topology
+
parameters
+
constraints
+
transactions
```

Neither Desktop, Quest nor AI owns canonical geometry.

## 2.2 Quest is a client, not another CAD implementation

Do not port or reimplement OCCT/OCAF on Quest for the first Quest architecture.

Quest receives:

- render geometry
- persistent semantic IDs
- feature metadata
- manipulator metadata
- dimension metadata
- model deltas
- selection metadata

Quest sends:

- semantic selections
- preview requests
- parameter changes
- command invocations
- transaction commits
- undo/redo requests

## 2.3 Never synchronize by files during a live session

Do not implement:

```text
save on PC
upload to Quest
edit
export from Quest
import on PC
```

Live Desktop ↔ Quest operation must happen through the session protocol.

Files remain for persistence, not live synchronization.

## 2.4 UI state is client-local unless explicitly shared

Shared authoritative state:

```text
document
bodies
features
parameters
geometry
constraints
history
model revision
```

Client-local state:

```text
camera
head pose
hover
pointer ray
hand pose
open panels
spatial panel placement
local UI mode
local selection where appropriate
viewport scale
```

Do not synchronize camera state between Desktop and Quest.

## 2.5 All modeling mutations go through typed commands

Desktop, Quest and AI must all invoke the same semantic command architecture.

Example:

```text
SetFeatureParameter
CreateHole
Extrude
Fillet
CreateSketch
AddConstraint
Undo
Redo
```

Never create Quest-only geometry mutation logic.

## 2.6 AI is not geometry

AI may plan and invoke validated commands.

AI may not:

- edit raw OCCT internals
- mutate meshes as canonical geometry
- invent entity IDs
- execute arbitrary native code
- bypass validation
- silently resolve ambiguous references

## 2.7 Spatial preview is not authoritative geometry

Quest may locally approximate a visual drag at headset frame rate.

The CAD core remains authoritative.

On commit:

```text
Quest preview
→ semantic command
→ CAD core recompute
→ authoritative mesh
→ Quest replaces preview
```

---

# PHASE 10 — Validation & Release Candidate

## 10.0 Objective

Freeze major feature development.

The CAD has accumulated enough functionality that the next priority is proving that it works as one coherent system.

No Quest implementation begins before Phase 10 passes.

## 10.1 Full regression command

Create one top-level test command such as:

```bash
pnpm test:all
```

It must run:

- native C++ tests
- feature tests
- topology tests
- frontend tests
- protocol tests
- persistence tests
- Electron E2E tests
- import/export tests
- current Phase 9 feature tests

Any failing subsystem must fail the command.

## 10.2 Golden workflow tests

Build real models from beginning to end.

### Workflow A — Parametric bracket

```text
Sketch
→ Extrude
→ second feature
→ Hole
→ Pattern
→ Fillet
→ expression-driven parameter
→ modify early dimension
→ recompute
→ Undo
→ Redo
→ Save
→ Close
→ Open
→ Export STEP
```

Verify:

- feature IDs stay stable
- topology resolves
- expressions recalculate correctly
- downstream references remain attached
- no invalid B-Rep
- undo/redo produces exact expected state

### Workflow B — Multi-body / rigid assembly

If current Phase 9 implements rigid assemblies:

```text
Create Body A
Create Body B
Create rigid assembly
Move instance
Save
Close
Open
Modify source body
Verify assembly instance
```

### Workflow C — Create from Reference

If Stage A exists:

```text
Import image
Calibrate scale
Create geometry from reference
Save
Reopen
Verify calibration
```

### Workflow D — Plugin

If Phase 9b exists:

```text
Install sandboxed test plugin
Register command
Run command
Disable plugin
Verify core remains stable
```

## 10.3 Persistent topology torture suite

Mandatory.

Modify parent features in ways likely to reorder topology:

```text
change box proportions
reverse dominant dimensions
change extrusion length
add/remove sketch geometry
change hole diameter
change pattern count
modify fillet radius
insert upstream feature
```

Expected behavior:

```text
unambiguous reference → resolve correctly
ambiguous reference   → explicit repair/error state
```

Never silently bind to a low-confidence face or edge.

## 10.4 Save/Open torture suite

Automate at least 100 cycles across representative projects:

```text
edit
save
close
open
edit
save-as
undo
redo
close
open
```

Verify:

- UUID stability
- feature graph
- parameters
- expressions
- assembly references
- reference-image metadata
- plugin-owned persistent data, if supported
- model revision

## 10.5 Crash recovery validation

Hard-kill:

- Electron renderer
- Electron main
- CAD core process

During:

- preview
- sketch solve
- recompute
- save
- STEP import
- large tessellation

Verify:

- recovery does not replay incomplete transactions
- project file is never replaced by a partially written file
- user can recover latest valid committed state

## 10.6 Resource testing

Stress:

```text
1000 create/delete body cycles
100 document open/close cycles
repeated STEP import
repeated tessellation
long viewport session
repeated plugin enable/disable
```

Monitor:

- native RAM
- Electron RAM
- GPU memory
- file handles
- worker count
- sidecar count
- Three.js resources

Fix critical leaks before proceeding.

## 10.7 Large-model baseline

Measure:

- 100k triangles
- 500k triangles
- 1M triangles
- high feature count
- many bodies
- large STEP file

Record:

```text
load time
time to first interactive frame
orbit FPS
selection latency
recompute latency
tessellation latency
RAM
GPU memory
save time
```

These measurements become baseline metrics for future Quest synchronization.

## 10.8 UX audit

A beginner must complete:

```text
100 × 60 × 10 block
centered Ø8 hole
four 3 mm fillets
change width to 120
Undo
Redo
Save
Export STEP
```

Record:

- completion time
- wrong clicks
- confusing terminology
- hidden state
- unnecessary dialogs

Fix critical blockers.

## 10.9 Phase 10 acceptance criteria

Phase 10 is complete only if:

- full regression is green
- topology torture tests pass
- persistence torture tests pass
- crash recovery is reliable
- no known critical resource leak
- installer works on a clean Windows machine
- representative complete projects remain editable after reopen
- current Phase 9 features are covered by regression tests

Then produce:

```text
PHASE 10 COMPLETION REPORT
Ready for Phase 11: YES / NO
```

Do not proceed if `NO`.

---

# PHASE 11 — Unified CAD Session Service + Semantic Control API

## 11.0 Objective

Evolve the current local CAD sidecar into a reusable authoritative session service that can simultaneously serve:

- Desktop
- Quest
- AI agent
- future clients

This phase replaces the idea of building separate one-off APIs for each client.

## 11.1 Target architecture

Current architecture may resemble:

```text
Electron
   │
stdin/stdout
   │
cad-core.exe
```

Evolve toward:

```text
                  cad-core
                     │
              CadSessionService
                     │
       ┌─────────────┼─────────────┐
       │             │             │
  Local Desktop    Network       Headless
       │             │             │
 Electron/TS      Quest/C#       AI client
```

The local Desktop path may remain optimized.

The session semantics must be common.

## 11.2 Protocol source of truth

Keep one schema source:

```text
cad_protocol.fbs
```

Generate bindings for:

```text
C++
TypeScript
C#
```

Required because:

```text
C++        → CAD core
TypeScript → Desktop
C#         → Unity Quest
```

No manually duplicated DTO definitions.

Two schema sources (Slice 7 decision B, see `docs/SESSION_PROTOCOL_DECISION.md`):
`schemas/session-control-v1.json` for the JSON control plane,
`cad_protocol.fbs` for the FlatBuffers data (mesh) plane.

## 11.3 Transport

Keep existing local transport where useful.

Add network transport for Quest.

Recommended implementation (Slice 7 decision B):

```text
WebSocket
+
JSON control frames (+ FlatBuffers binary mesh when the Quest slice needs it)
```

Requirements:

- persistent connection
- JSON control payloads (binary mesh stays sidecar-direct until Phase 12)
- request/response IDs
- server-pushed model deltas
- protocol version
- client ID
- document/session ID
- authentication/pairing token for LAN access

Do not use REST as the main real-time model transport.

## 11.4 Session model

Create:

```text
CadSession
```

Conceptually:

```ts
CadSession {
  sessionId
  documentId
  documentRevision
  connectedClients
  transactionState
}
```

Clients:

```text
DesktopClient
QuestClient
AgentClient
```

Each has:

```text
clientId
clientType
capabilities
connectionState
```

## 11.5 Shared vs local state

Server owns:

```text
authoritative document
feature DAG
B-Rep
model revision
undo/redo
persistent topology
saved state
```

Client owns:

```text
camera
hover
UI state
temporary gestures
spatial panel layout
render preferences
```

Selection policy:

- selection is local by default
- client may publish an `activeEditTarget`
- shared highlights are optional metadata
- model mutations are shared

## 11.6 Model deltas

Do not resend the complete model for every change.

Use:

```text
ModelDelta
```

with:

```text
baseRevision
newRevision
added entities
updated entities
removed IDs
changed meshes
reference remaps
warnings
```

If revision mismatch occurs:

```text
client requests full snapshot
```

## 11.7 Semantic query API

Required:

```text
getDocumentInfo()
getBodies()
getFeatures()
getFeature(id)
getParameters(featureId)
getDependencies(featureId)
getModelTree()
describeModel()
```

`describeModel()` must return compact semantic information suitable for both AI and Quest UI.

Never dump raw B-Rep through this API.

## 11.8 Semantic selection API

Required:

```text
getSelection(clientId)
setSelection(clientId, ids)
clearSelection(clientId)

findFaces(query)
findEdges(query)
findBodies(query)
```

Search may include:

```text
surface type
orientation
owner body
feature role
approximate dimensions
radius
normal
axis
semantic role
```

Return:

```text
persistent ID
confidence
description
owner
geometric summary
```

Never silently choose ambiguous results.

## 11.9 Manipulator metadata API

This is mandatory for Quest.

Features expose semantic manipulators.

Example:

```json
{
  "featureId": "extrude-42",
  "manipulators": [
    {
      "id": "distance",
      "type": "linear",
      "parameter": "distance",
      "axis": [0, 0, 1],
      "origin": [0, 0, 20],
      "unit": "mm"
    }
  ]
}
```

Hole:

```json
{
  "featureId": "hole-9",
  "manipulators": [
    {
      "id": "diameter",
      "type": "radial",
      "parameter": "diameter"
    },
    {
      "id": "depth",
      "type": "linear",
      "parameter": "depth"
    }
  ]
}
```

The Quest client must not hardcode feature-specific geometry rules where metadata can describe them.

## 11.10 Typed command API

Expose the existing command system to session clients.

Examples:

```text
CreateBox
CreateSketch
AddSketchLine
AddSketchCircle
AddConstraint
Extrude
Revolve
CreateHole
Fillet
Chamfer
Shell
Mirror
Pattern
SetFeatureParameter
SetExpression
DeleteFeature
Undo
Redo
```

All mutations remain validated by core command schemas.

## 11.11 Preview protocol

Required:

```text
BeginPreview
UpdatePreview
CommitPreview
CancelPreview
```

Preview must have:

```text
previewId
clientId
baseRevision
target feature
parameter/value
```

The authoritative model revision changes only when appropriate according to existing transaction architecture.

## 11.12 Transaction grouping

Support:

```text
BeginTransaction
Command
Command
Command
CommitTransaction
```

A semantic multi-command user operation can become one Undo step.

On failure:

```text
rollback transaction
```

unless explicitly designed otherwise.

## 11.13 Concurrency policy

Initial assumption:

```text
single human user
multiple connected clients
```

Do not implement Google-Docs-style collaborative CAD yet.

Use controlled mutation serialization.

If Desktop and Quest attempt conflicting edits:

```text
first active mutation owns feature/transaction lock
```

Return a structured `BUSY/CONFLICT` response to the other client.

Do not allow concurrent mutation of the same OCAF document from separate threads.

## 11.14 Idempotency

Every mutation supports:

```text
requestId
operationId
```

Retry after timeout must not duplicate geometry.

## 11.15 Agent-facing methods

Phase 11 also establishes the machine-facing API:

```text
measureDistance
measureAngle
measureRadius
measureDiameter
measureArea
measureVolume
getBoundingBox
validateDocument
validateBody
validateFeature
validateReferences
listCommands
getCommandSchema
getCapabilities
```

This avoids building a second API later.

## 11.16 LAN security

Quest connection must not expose an unauthenticated CAD server to the LAN.

Implement pairing.

Example:

```text
Desktop:
Quest Connection
[ Pair Device ]

One-time code: 482731
```

Quest enters code or uses a pairing token.

Persist trusted device identity locally.

Requirements:

- bind only to intended interfaces
- no public internet listener
- per-session token
- connection revocation
- protocol version negotiation

## 11.17 Phase 11 acceptance criteria

Without GUI automation:

1. Desktop opens a document.
2. Second test client connects over network protocol.
3. Second client receives full snapshot.
4. Second client changes a parameter.
5. Desktop receives delta and updates.
6. Desktop performs Undo.
7. Second client receives updated delta.
8. Both clients remain on same revision.
9. Disconnect/reconnect recovers state.
10. Invalid or stale mutation is rejected safely.

Only after this passes should Unity/Quest work begin.

---

# PHASE 12 — Quest Spatial Client Foundation

## 12.0 Objective

Create a new Quest frontend for the existing CAD.

Do not create a second modeling kernel.

Preferred stack:

```text
Unity
C#
OpenXR
Meta XR SDK
Meta XR Interaction SDK where useful
JSON session control DTOs + FlatBuffers C# bindings (mesh data plane)
WebSocket transport
```

Target Quest 3 first.

## 12.1 Client responsibilities

Quest handles:

```text
rendering
head tracking
hand tracking
controller input
MR passthrough
spatial UI
local visual previews
client-local camera/world placement
```

PC/core handles:

```text
B-Rep
feature graph
constraints
persistent topology
save/open
recompute
transactions
authoritative geometry
```

## 12.2 Connection flow

On Quest launch:

```text
Find paired PC
→ Connect
→ Select active CAD session
→ Receive model snapshot
→ Render
```

If Desktop already has a project open:

```text
Quest joins that live project
```

No manual file transfer.

## 12.3 Scene representation

Quest receives render-neutral geometry buffers.

Convert to Unity Mesh.

Each rendered body must preserve mapping to:

```text
body persistent ID
face persistent IDs
edge persistent IDs
feature owner
```

A ray/hand hit on a triangle must resolve back to the same semantic CAD reference used by Desktop.

## 12.4 Mesh streaming

Use model deltas.

For changed bodies:

```text
core tessellates
→ binary mesh update
→ Quest replaces affected mesh
```

Do not rebuild the full Quest scene for one changed hole.

## 12.5 LOD strategy

Quest has lower rendering budget than desktop.

Support:

```text
preview LOD
normal interactive LOD
high-detail inspection LOD
```

The server may send different tessellation quality for Quest.

Quest may request:

```text
RequestMeshLOD(bodyId, quality)
```

## 12.6 World placement

Implement two independent transforms:

```text
CAD model coordinates
```

and

```text
Quest display/world transform
```

Moving or scaling the displayed model in MR must not modify CAD geometry.

This enables:

```text
1:10
1:5
1:1
2:1
10:1
Fit
```

without changing dimensions.

## 12.7 MR mode

Support Quest passthrough.

Initial MR features:

- place model on real table
- reposition model
- rotate display
- visual scale control
- 1:1 mode
- recenter
- persist local anchor during session

Do not treat physical-world placement as model geometry.

## 12.8 VR fallback mode

Also support a simple neutral VR workspace.

Useful when:

- passthrough is undesirable
- visual contrast is poor
- user wants isolated workspace

Same CAD session, different environment.

## 12.9 Rendering style

Use CAD-oriented rendering:

- clear shaded surfaces
- high-quality edge overlay
- selected-face highlight
- selected-edge highlight
- transparent preview geometry
- readable spatial dimensions

Avoid game-like visual clutter.

## 12.10 Quest client-local state

Store locally:

```text
world placement
display scale
dominant hand
UI handedness
panel placement
interaction preferences
passthrough preference
```

Do not store these as CAD model parameters.

## 12.11 Performance targets

Quest interaction loop should target headset refresh rate.

Critical rule:

```text
hand/head response must never wait on network round-trip
```

Network/core updates may run at lower frequency.

Track:

```text
render FPS
network RTT
mesh update latency
preview latency
memory
triangle count
```

## 12.12 Phase 12 acceptance criteria

With CAD open on PC:

1. Launch Quest client.
2. Pair/connect.
3. Same open model appears.
4. Walk around/view model in MR.
5. Place model on a real surface.
6. Switch display scale.
7. Select a body/face.
8. Desktop sees optional shared edit target.
9. Desktop changes feature parameter.
10. Quest updates without reload.
11. Quest disconnect/reconnect restores current model.

No modeling gestures are required yet beyond basic selection.

---

# PHASE 13 — Quest Spatial Interaction & MR UX

## 13.0 Objective

Make Quest a genuinely useful CAD interaction mode, not a desktop UI floating in VR.

Primary principle:

```text
THE MODEL ITSELF IS THE UI
```

Spatial panels exist only when needed.

## 13.1 Interaction modes

Implement explicit modes:

```text
MODEL MODE
EDIT MODE
```

### MODEL MODE

Manipulates visualization:

```text
move displayed model
rotate displayed model
scale displayed model
recenter
```

No CAD geometry changes.

### EDIT MODE

Manipulates semantic CAD features:

```text
face
edge
hole
sketch
manipulator
dimension
```

This separation prevents accidental geometry edits.

## 13.2 Hand interaction

Use Quest-native hand tracking.

Core gestures should remain minimal.

Recommended baseline:

```text
point/ray       → hover
pinch           → select
pinch + hold    → grab/manipulate
open palm       → global/context menu
two-hand grab   → manipulate displayed model in MODEL MODE
```

Do not create dozens of gesture vocabulary items.

Context determines meaning.

## 13.3 Intent lock

Once a manipulation begins, lock its semantic meaning.

Example:

```text
pinch extrusion handle
→ intent = AdjustExtrusionDistance
```

Until release/cancel, hand-tracking jitter cannot reinterpret it as:

```text
orbit
select
scale
other command
```

This is mandatory for stable spatial CAD.

## 13.4 Axis and constraint locking

Never map raw hand 3D motion directly to arbitrary CAD geometry.

Example:

```text
selected extrusion manipulator axis = face normal
```

Project hand displacement onto that axis:

```text
raw hand delta = (x, y, z)
→ projected scalar distance
→ parameter preview
```

This converts noisy hand motion into stable CAD input.

## 13.5 Local prediction / ghost preview

Do not wait for:

```text
hand
→ Wi-Fi
→ OCCT recompute
→ tessellation
→ Wi-Fi
→ Quest
```

for every frame.

Instead:

```text
hand drag
→ local ghost preview at headset frame rate
→ throttled PreviewParameter messages to PC
→ occasional authoritative preview update
→ release
→ CommitParameter
→ final authoritative mesh
```

Local preview is visual only.

## 13.6 Manipulator types

Support semantic manipulators:

```text
linear
radial
angular
planar
position
```

Examples:

### Extrude

```text
linear handle
→ distance
```

### Hole

```text
radial handle
→ diameter

linear handle
→ depth
```

### Fillet

```text
radial/linear semantic handle
→ radius
```

### Sketch dimension

```text
dimension label
→ numeric editing
```

## 13.7 Spatial dimensions

Dimensions appear close to relevant geometry.

Example:

```text
←──── 120 mm ────→
┌─────────────────┐
│                 │
└─────────────────┘
```

Requirements:

- always face/read toward user appropriately
- avoid excessive overlap
- selected dimension gets priority
- units always visible
- large enough for Quest readability

## 13.8 Precision workflow

Hand movement is for intent and rough adjustment.

Precise value comes from:

```text
snap
numeric panel
voice
```

Example:

```text
drag roughly to 118.6 mm
→ nearby snap values: 115 / 120 / 125
→ user selects 120
```

Never imply sub-millimeter accuracy from hand pose.

## 13.9 Voice + spatial selection

Add optional voice commands.

The hand establishes context.

Example:

```text
user selects face
says: "120 millimeters"
→ selected feature parameter = 120 mm
```

Or:

```text
select edges
"fillet five"
→ preview Fillet(radius=5 mm)
```

Voice parser should use the same semantic command system as Desktop and AI.

Do not implement a separate Quest-only natural-language engine.

## 13.10 Palm menu

Use palm UI for global actions.

Example:

```text
        Create
          ↑

Measure ← ● → Modify

          ↓
        History
```

Keep it minimal.

Potential global actions:

- Create
- Modify
- Measure
- Undo
- Redo
- View
- Scale
- Desktop/Quest session status

## 13.11 Context actions on geometry

Selecting a planar face may expose:

```text
Pull
Hole
Sketch
Offset
Measure
```

Selecting an edge:

```text
Fillet
Chamfer
Measure
Select Similar
```

Selecting a body:

```text
Move display focus
Duplicate
Boolean
Mirror
Pattern
```

The command registry determines availability.

Do not duplicate context logic in Unity.

## 13.12 Spatial advanced panel

When needed, show a 3D panel:

```text
┌────────────────────────┐
│ Extrude                │
│                        │
│ Distance     120 mm    │
│ Direction    Normal    │
│ Draft        0°        │
│                        │
│      Confirm Cancel    │
└────────────────────────┘
```

Panel can be:

- attached near feature
- pinned in space
- summoned from palm

Do not recreate the entire desktop UI.

## 13.13 Undo/Redo in Quest

Support:

- palm menu
- optional voice
- optional gesture later

Undo affects the same authoritative document.

Desktop updates immediately.

## 13.14 Desktop + Quest simultaneous workflow

Mandatory scenario:

```text
Desktop:
create sketch
extrude
create holes

Quest joins same session

Quest:
inspect at 1:1
pull one feature
set exact value
add fillet

Desktop:
feature tree updates live

Quest removed

Desktop:
continue editing expressions
```

No Save/Reload step.

## 13.15 Real-world context

MR 1:1 mode should allow user to visually inspect a virtual part in the physical environment.

Examples:

```text
place bracket on real wall
place top on real table
inspect enclosure size next to physical device
```

This is a visualization/design aid.

Do not claim physical measurement accuracy beyond tracked system capabilities.

## 13.16 Optional controller support

Hand tracking is primary for intuitive manipulation.

Controllers may be supported for:

- long precision sessions
- stable pointing
- accessibility
- fallback

Controller and hand actions map into the same semantic input layer.

## 13.17 Quest testing

Create tests/manual test protocol for:

- lost hand tracking during preview
- Wi-Fi latency spike
- temporary disconnect
- client reconnect
- user removes headset mid-edit
- preview cancel
- stale model revision
- Desktop edits same feature during Quest manipulation
- Undo from Desktop while Quest is viewing result
- model with high triangle count

No data corruption is acceptable.

## 13.18 Phase 13 acceptance criteria

A user must be able to:

1. Open model on PC.
2. Put on Quest.
3. Join same session.
4. Place model in MR.
5. Select a face.
6. Pull it spatially.
7. Set exact value by snap/numeric/voice.
8. Commit.
9. See Desktop update.
10. Select edges.
11. Create a fillet.
12. Undo from Quest.
13. Remove headset.
14. Continue on Desktop with no synchronization step.

If that complete workflow is not reliable, Phase 13 is not complete.

---

# PHASE 14 — Autonomous Modeling Agent

## 14.0 Objective

Build a controlled modeling agent using the same Phase 11 semantic/session API used by Desktop and Quest.

The agent is another client.

Architecture:

```text
               CAD Session Service
             /          |          \
        Desktop       Quest        Agent
```

## 14.1 Agent loop

```text
PLAN
  ↓
BUILD
  ↓
INSPECT
  ↓
MEASURE
  ↓
VALIDATE
  ↓
CORRECT
```

Do not use:

```text
prompt
→ commands
→ assume success
```

## 14.2 Structured plan

Example:

```json
{
  "goal": "Create an L bracket 100 mm high, 60 mm wide, 5 mm thick, with four 8 mm holes.",
  "requirements": {
    "heightMm": 100,
    "widthMm": 60,
    "thicknessMm": 5,
    "holeCount": 4,
    "holeDiameterMm": 8
  },
  "steps": [
    {
      "id": "s1",
      "command": "CreateSketch"
    },
    {
      "id": "s2",
      "command": "Extrude",
      "dependsOn": ["s1"]
    }
  ]
}
```

Persist only concise actionable planning data.

## 14.3 Agent introspection

Agent uses:

```text
describeModel
getFeature
getParameters
findFaces
findEdges
measure*
validate*
listCommands
getCommandSchema
```

Never screen-scrape the Desktop UI.

## 14.4 Goal validation

Convert request into machine-checkable conditions.

After building:

```text
measure
validate
compare to goal
```

Do not report success if requirements fail.

## 14.5 Ambiguity handling

Example:

```text
"make the hole bigger"
```

If multiple holes match:

```text
do not guess
```

Use:

- selection context
- semantic search
- concise clarification
- optional highlight candidates in Desktop/Quest

## 14.6 Transaction grouping

One high-level request should normally be one user-visible Undo group.

Example:

```text
"Create mounting plate"
```

One Undo can remove the generated feature group if appropriate.

## 14.7 Hard limits

Set:

```text
max commands/request
max iterations
max correction loops
max created features
max wall-clock time
```

No infinite autonomous loop.

## 14.8 Benchmark suite

Permanent prompts with machine-verifiable targets:

```text
plate with centered hole
U bracket
flange with six holes
hollow box
shaft with chamfer
simple enclosure
mounting plate
```

Track:

```text
success rate
command count
repair count
time
validation failures
```

## 14.9 Multi-client benefit

When Agent modifies model:

```text
Desktop updates
Quest updates
```

When Quest user selects a face and asks AI:

```text
"make this symmetrical"
```

the Agent receives the same persistent selection ID.

This is a key goal of the unified session architecture.

## 14.10 Phase 14 acceptance criteria

- ≥80% simple benchmark success
- no fabricated persistent IDs
- no invalid B-Rep reported as success
- all geometry changes use registered commands
- model remains editable
- Desktop and Quest receive live updates from agent actions

---

# PHASE 15 — Advanced CAD

## 15.0 Objective

Expand serious CAD capability without copying every traditional CAD feature.

Prioritize capabilities that strengthen the existing parametric model.

## 15.1 Reference geometry

Add/improve:

```text
datum planes
datum axes
datum points
offset planes
midplanes
angle planes
three-point planes
```

All must have:

- stable UUID
- dependency graph
- persistent references

## 15.2 Projected geometry

Support:

```text
project edge
project silhouette
intersect geometry
external references
```

Broken references must be explicit.

## 15.3 Advanced sketching

Add/improve:

```text
ellipse
elliptical arc
B-spline
control-point spline
construction geometry
trim/extend
sketch mirror
sketch patterns
```

Require solver/regression coverage.

## 15.4 Surface modeling

Add:

```text
surface bodies
surface extrude
surface revolve
surface loft
surface sweep
offset surface
trim
extend
sew/stitch
thicken
```

Surface and solid bodies remain distinct.

## 15.5 Section view

Desktop and Quest should both support sectioning.

Authoritative section definition may be shared, but display presentation is client-specific.

Quest section manipulation can be spatial.

## 15.6 Analysis tools

Add:

```text
mass properties
center of mass
volume
area
draft analysis
curvature visualization
zebra analysis
minimum thickness
interference check
```

Analysis tools do not mutate geometry.

## 15.7 Assemblies

Build on rigid assemblies already created in current Phase 9, if present.

Add incrementally:

```text
part instances
component tree
ground/fix
coincident mate
concentric mate
distance mate
angle mate
parallel
perpendicular
```

Do not attempt full industrial assembly solving in one step.

Quest should eventually be especially useful for:

```text
spatially inspecting assemblies
exploded views
component placement preview
```

but authoritative constraints remain deterministic.

## 15.8 Configurations

Support parameter overrides:

```text
Small
Medium
Large
```

Do not duplicate complete model geometry for each configuration.

## 15.9 Direct editing imported B-Rep

Explicit history features:

```text
MoveFace
OffsetFace
DeleteFace
ReplaceFace
```

Never mutate imported geometry invisibly.

## 15.10 Phase 15 acceptance criteria

At minimum:

```text
datum plane → sketch → feature
project edge → downstream edit
surface loft → sew → solid
configuration switch
basic constrained assembly
Desktop/Quest both display resulting model correctly
```

---

# PHASE 16 — Intent / Generative Modeling

## 16.0 Objective

Move beyond command-centric CAD.

The system should understand higher-level design intent while still generating normal editable parametric features.

## 16.1 Intent graph

Optional semantic layer above the feature graph.

Example:

```text
Goal:
Mount motor to plate

Intent relationships:
motor axis
plate face
four mounting points
clearance
symmetry
```

Feature graph remains canonical geometry.

## 16.2 Pattern inference

Detect repeated manual behavior.

Example:

```text
three similar holes
regular spacing
```

Suggest:

```text
Convert to pattern?
```

If accepted:

- create explicit pattern
- preserve geometry
- one transaction
- reversible

## 16.3 Symmetry inference

Detect near symmetry.

Suggest:

```text
Keep these sides symmetric?
```

If accepted, create an explicit relation.

Do not continuously rely on fuzzy inference.

## 16.4 Constraint suggestions

Examples:

```text
same diameter
equal length
same center
parallel
perpendicular
symmetric
aligned
midpoint
equal spacing
```

Requirements:

- non-blocking
- reversible
- explainable

## 16.5 High-level parametric generators

Examples:

```text
mounting plate
enclosure
bracket
flange
adapter
spacer
frame
```

Output ordinary editable features.

Never output an opaque mesh blob.

## 16.6 Design-from-function

Example:

```text
"I need to connect these two plates 80 mm apart."
```

System may propose:

```text
L bracket
U bracket
spacer
standoffs
```

When multiple valid solutions exist:

```text
present options
```

Do not silently choose a single engineering design.

## 16.7 Quest + intent interaction

Quest enables spatial intent specification.

Examples:

```text
user points to two faces
"connect these"
```

or:

```text
user selects four edges
"make these equal"
```

or:

```text
user positions a reference point in MR
"align the hole here"
```

The spatial client provides semantic references.

The intent/agent layer produces typed CAD commands.

## 16.8 Create from Reference expansion

Build on current Phase 9 Stage A if implemented.

Possible progression:

```text
Stage A
image plane + calibration

Stage B
line/circle detection

Stage C
vision-assisted feature proposal

Stage D
editable parametric reconstruction
```

Never make opaque mesh reconstruction the default CAD result.

## 16.9 Explainability

Generated features should expose concise rationale:

```text
Pattern created because four equally spaced mounting holes were requested.
```

No hidden reasoning dump is required.

## 16.10 Phase 16 acceptance criteria

Demonstrate:

- pattern inference
- symmetry inference
- high-level parametric generator
- one design-from-function workflow
- Quest-selected geometry usable as intent context
- all generated geometry remains editable
- no irreversible opaque generation path

---

# 3. Explicitly out of scope

The following are not part of this roadmap:

```text
CAM
CNC post-processing
toolpath generation
machine simulation
5-axis machining
manufacturing workspace
```

Do not create architectural scaffolding specifically for them.

General modularity is enough.

---

# 4. Revised execution order

The coding agent must follow:

```text
Finish current autonomous Phase 9
        ↓
STOP
        ↓
Produce Phase 9 completion report
        ↓
Phase 10 — Validation
        ↓
STOP / REVIEW
        ↓
Phase 11 — Unified Session Service
        ↓
STOP / REVIEW
        ↓
Phase 12 — Quest Foundation
        ↓
STOP / REVIEW
        ↓
Phase 13 — Quest Spatial UX
        ↓
STOP / REVIEW
        ↓
Phase 14 — Autonomous Agent
        ↓
Phase 15 — Advanced CAD
        ↓
Phase 16 — Intent / Generative Modeling
```

Do not automatically run all phases in one unattended pass.

---

# 5. Why Quest comes before the autonomous agent

The order is intentional.

Phase 11 creates the common semantic/session architecture.

Then:

```text
Quest
```

and:

```text
AI Agent
```

become clients of the same system.

Implementing Quest first stress-tests:

- model deltas
- network transport
- semantic selection
- manipulator metadata
- preview lifecycle
- transaction ownership
- multi-client state

These are also useful for the autonomous agent.

The shared platform becomes stronger before autonomy is added.

---

# 6. Required cross-client invariant

At every point after Phase 11:

```text
Desktop model revision
=
Quest model revision
=
Agent-visible model revision
```

for all connected clients after they process the latest committed delta.

If a client falls behind:

```text
resync
```

Do not allow stale state to silently mutate the document.

---

# 7. Required completion report format

At the end of every phase:

```text
PHASE X COMPLETION REPORT

Implemented:
- ...

Tests:
- unit:
- integration:
- E2E:
- manual:

Architecture changes:
- ...

Protocol changes:
- ...

Performance:
- ...

Known limitations:
- ...

Regressions:
- ...

Ready for next phase:
YES / NO
```

If `NO`, stop.

---

# 8. Coding-agent execution policy

For each implementation slice:

```text
1. inspect existing implementation
2. avoid replacing stable architecture
3. identify smallest integration point
4. implement
5. compile
6. run focused tests
7. run regressions
8. document protocol/schema changes
9. continue
```

No silent architectural rewrites.

---

# 9. Conflict protocol

If a requested phase conflicts with the existing codebase:

STOP and report:

```text
conflict
affected subsystem
why it conflicts
minimal viable solution
alternative solutions
migration cost
recommended path
```

Do not invent a parallel architecture without approval.

---

# 10. Immediate instruction to the coding agent

The file is being delivered while the coding agent is already executing its own Phase 9.

Therefore:

```text
DO NOT INTERRUPT OR RESTART THE CURRENT PHASE 9.
```

Complete the currently planned Phase 9 slices.

Then:

```text
STOP.
PRODUCE A COMPLETE PHASE 9 REPORT.
WAIT FOR REVIEW.
```

After approval:

```text
START PHASE 10 OF THIS DOCUMENT.
```

Do not interpret this roadmap as permission to skip the validation phase.

---

# 11. Final product vision

The final product should feel like one CAD with several interfaces:

```text
                         SAME CAD
                            │
          ┌─────────────────┼─────────────────┐
          │                 │                 │
          ▼                 ▼                 ▼
      DESKTOP             QUEST              AGENT
     precision           spatial            autonomy
     keyboard            hands              planning
     detailed UI         MR/VR              validation
```

Desktop is best for:

```text
exact numeric editing
complex feature management
expressions
file management
dense information
```

Quest is best for:

```text
spatial understanding
scale perception
direct manipulation
1:1 inspection
MR context
hands + voice
```

Agent is best for:

```text
automation
multi-step planning
semantic interpretation
repetitive construction
validation loops
```

The product must not force one interface to imitate another.

The shared invariant is:

```text
one document
one model
one history
one CAD core
many specialized clients
```

That is the architecture to preserve.
