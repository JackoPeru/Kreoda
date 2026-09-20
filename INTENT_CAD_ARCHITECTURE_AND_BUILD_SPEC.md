# INTENT-CAD — Technical Architecture & Build Specification

> **Purpose of this document**  
> This is the implementation specification for a desktop CAD/modeling application designed around **direct manipulation, intent inference, invisible parametrization, progressive disclosure, and optional natural-language control**.  
> The target user must be able to create precise 3D objects on day 0 without knowing traditional CAD terminology, while the underlying model remains a real parametric B-Rep CAD model rather than a disposable triangle mesh.
>
> **Primary target:** Windows desktop first, then macOS/Linux.  
> **Product goal:** a user-friendly solid modeler positioned between Tinkercad/SketchUp simplicity and Fusion/SolidWorks-style parametric power.  
> **Not the initial goal:** animation, rigging, VFX, sculpting, rendering workflows, or full Blender parity.

---

# 0. Non-negotiable design principles

The implementation must preserve these rules from the beginning.

1. **The canonical model is B-Rep, not triangles.**
   - Triangle meshes are generated for viewport rendering and mesh-format export.
   - Modeling operations must be performed by the CAD kernel whenever the input is a CAD solid.

2. **Never identify a face/edge only by array index.**
   - `Face #5` and `Edge #12` are not stable identifiers after recomputation.
   - Persistent topology references must be treated as a first-class architectural problem.

3. **The UI is not allowed to own the authoritative CAD state.**
   - React holds UI state, camera state, selection state, temporary interaction state, and a read-only projection of the model.
   - The native CAD core owns the canonical feature graph, topology, parameters, transactions, persistent references, and saved document.

4. **Every modeling operation is a typed command.**
   - Mouse interactions, command palette, keyboard shortcuts, plugins, and AI all invoke the same command system.
   - Do not build a separate hidden path for AI-generated geometry.

5. **Natural-language AI must never directly generate or edit raw mesh vertices.**
   - AI outputs validated typed commands such as `CreateBox`, `ExtrudeProfile`, `CreateHole`, `SetDimension`, `FilletEdges`, `PatternCircular`.
   - The deterministic CAD core executes those commands.

6. **Preview and commit are separate concepts.**
   - Dragging a handle may recompute temporary preview geometry many times.
   - Mouse/pointer release creates one committed modeling transaction and therefore one Undo step.

7. **Simple mode and advanced mode operate on the same model.**
   - Do not build a “toy” simple modeler and a separate expert modeler.

8. **The product must remain useful with AI disabled.**
   - Intent inference should first use deterministic geometry/context heuristics.
   - AI is an accelerator, not the foundation of the CAD kernel.

---

# 1. Final stack decision

## 1.1 Desktop shell: Electron

Use:

- **Electron 44.x stable** as the initial desktop shell.
- At the date this specification was written (2026-09-18), Electron **44.4.2** was a current stable release.
- **Node.js is used only in the Electron main/preload environment**, never exposed wholesale to the renderer.
- `contextIsolation: true`
- `sandbox: true` for normal renderer windows.
- strict, narrow preload API.

### Why Electron instead of Tauri

Tauri is excellent for small applications, but its rendering engine depends on the platform webview:

- Windows: WebView2 / Chromium
- macOS: WKWebView / WebKit
- Linux: WebKitGTK

For a CAD viewport we want the browser/GPU behavior to be as deterministic as reasonably possible across machines. Electron ships its own Chromium version, so Three.js/WebGL/WebGPU behavior can be developed and tested against one controlled rendering runtime.

The extra RAM/disk footprint is acceptable for a desktop CAD application because:

- the application already needs a native geometry kernel;
- the viewport itself is GPU-intensive;
- predictability matters more than shaving tens of MB from the shell;
- Electron is highly agent-friendly and has mature desktop packaging/update tooling.

### Why not Qt as the primary UI

A Qt/C++ application is technically viable and OpenCascade has Qt samples, but it is not the preferred architecture here because:

- modern product UI iteration is faster in React/TypeScript;
- the coding-agent ecosystem is much stronger around TS/React;
- a Chromium viewport is easier to inspect/test automatically;
- Qt licensing must be handled carefully for commercial distribution;
- some Qt modules, including Qt Quick 3D in the open-source distribution, are GPL rather than LGPL.

Qt remains a valid fallback for a future fully native edition, but do not start there.

---

## 1.2 Frontend/UI

Use:

- **React 19.3**
- **TypeScript**
- **Vite 8.1+**
- **Tailwind CSS 4.x**
- **Radix UI primitives** for accessible low-level UI building blocks
- **Lucide** for icons
- **Floating UI** for context toolbars/popovers
- **cmdk** or an equivalent lightweight command-palette primitive
- **Zustand** for simple application UI state
- **XState** or a small explicit finite-state machine for complex pointer/tool interaction state

Do **not** put high-frequency viewport state into React component trees.

React is for:

- top toolbar
- object/feature tree
- properties panel
- command bar
- dialogs
- preferences
- file/recent project UI
- contextual overlays

The viewport must be an imperative subsystem with its own render loop.

---

## 1.3 3D viewport

Use:

- **Three.js**
- default backend initially: **WebGL2**
- optional/experimental backend later: **WebGPU**
- **three-mesh-bvh** for accelerated picking and spatial queries
- Three.js wide-line primitives (`Line2`, `LineSegments2`) or an equivalent custom line shader for CAD edges
- custom CAD camera controls; OrbitControls can be used as a base but must not define final UX

### Why Three.js

Three.js is preferred over Babylon.js here because:

- the existing browser-CAD ecosystem around OpenCascade.js, RepliCAD and CascadeStudio already demonstrates Three.js integration;
- `three-mesh-bvh` is extremely useful for high-performance CAD picking;
- the engine is unopinionated enough to build a CAD-specific renderer;
- agent familiarity and examples are abundant.

Babylon.js has excellent WebGPU support and is a valid alternative, but switching to it does not solve the hard CAD problems: topology, sketch constraints, feature history, reference stability, and direct manipulation.

### WebGPU policy

Do not make WebGPU mandatory in V1.

CAD viewport workloads generally benefit more from:

- smart tessellation,
- BVH picking,
- geometry batching,
- LOD,
- efficient updates,
- avoiding unnecessary React renders,

than from immediately migrating the full viewport to WebGPU.

Build an abstraction so a WebGPU renderer can be enabled later.

---

# 2. Native CAD core

## 2.1 Language

Use **C++17 or newer**, with **C++17 as the compatibility baseline** because OpenCascade 8.0.x establishes that baseline.

Build with:

- CMake
- vcpkg manifest mode
- MSVC on Windows
- Clang/GCC on other platforms

Do not write the geometry kernel in TypeScript.

---

## 2.2 Geometry kernel: Open CASCADE Technology 8.0.1

Use **OCCT 8.0.1** as the primary geometric kernel.

Required OCCT areas include:

- primitives
- B-Rep topology
- boolean operations
- extrude/prism
- revolve
- sweep/pipe
- loft
- fillet
- chamfer
- shell/thickness
- offset
- transforms
- intersection
- sectioning
- tessellation
- shape validation/healing
- STEP import/export
- IGES import/export
- BREP persistence
- STL/OBJ/glTF where useful
- OCAF/XCAF application framework

### Why OCCT

It provides a real industrial CAD kernel rather than forcing the project to implement:

- NURBS/B-splines
- exact topology representation
- robust intersections
- sewing/healing
- STEP exchange
- boolean topology history
- fillets/chamfers
- feature-level geometry services

from scratch.

As of 8.0.1, OCCT includes additional modeling reliability fixes around booleans, periodic curves, shape healing, meshing, STEP export, and concurrent fillet work.

### Licensing requirement

OCCT is LGPL 2.1 with the Open CASCADE exception. Prefer **shared-library linking** in commercial/proprietary builds unless licensing counsel approves another strategy.

The application must ship the relevant license notices and satisfy LGPL obligations.

Do not silently statically link OCCT into a proprietary executable without reviewing the license implications.

---

# 3. OCAF is mandatory, not optional

Use **OCAF (Open CASCADE Application Framework)** from the beginning.

It solves several problems that otherwise become expensive architectural rewrites:

- persistent application data
- document model
- transactions
- Undo/Redo
- persistence
- parametric dependencies
- persistent reference keys
- topological naming infrastructure
- XCAF document data for assembly/name/color/material-style information

## 3.1 Why this matters

A naïve CAD implementation often stores:

```text
feature_12.targetFace = 5
```

After changing an earlier extrusion, face ordering changes and the model breaks.

Instead, use OCAF/TNaming mechanisms to track topology evolution and preserve references as shapes are generated, modified, or deleted.

## 3.2 Persistent topology references

Use:

- `TNaming_NamedShape`
- `TNaming_Builder`
- `TNaming_Selector`
- `TNaming_Tool`
- algorithm-generated topology history (`Generated`, `Modified`, `Deleted` where exposed)

For every operation capable of changing topology:

1. execute OCCT operation;
2. record the resulting shape;
3. record generated/modified/deleted sub-shape relationships;
4. update OCAF naming information;
5. resolve all downstream references;
6. rebuild dependent features.

### Never do this

```cpp
auto targetFace = faces[5];
```

and persist `5`.

Array indices are allowed only as transient iteration values.

---

# 4. Add a second topology-resilience layer

OCAF naming should be the primary mechanism, but the app should also have a semantic fallback.

For every selected persistent subshape, maintain a fallback descriptor containing appropriate information such as:

- entity type: face / edge / vertex
- surface type: plane / cylinder / cone / sphere / BSpline...
- curve type for edges
- approximate area or length
- centroid
- normal / axis
- radius where meaningful
- adjacency graph signature
- owner feature UUID
- creation role where available:
  - `extrusion.side.fromEdge:<uuid>`
  - `extrusion.cap.start`
  - `extrusion.cap.end`
  - `hole.cylindricalWall`
- local geometric signature with tolerances

Resolution order:

1. OCAF/TNaming persistent reference.
2. explicit feature-role reference.
3. semantic geometric fallback.
4. if ambiguous: mark the feature as needing repair and show a human-readable recovery UI.

Never silently choose a low-confidence face.

---

# 5. Constraint solver

## 5.1 Initial open-source solver: FreeCAD PlaneGCS

Use the **PlaneGCS solver from FreeCAD Sketcher** behind a project-owned interface:

```cpp
class ISketchSolver {
public:
    virtual SolveResult solve(const SketchModel&, const SolveOptions&) = 0;
    virtual SolverDiagnostics diagnose(const SketchModel&) = 0;
    virtual ~ISketchSolver() = default;
};
```

PlaneGCS supports the type of numeric constraint solving needed for:

- coincident
- horizontal
- vertical
- parallel
- perpendicular
- equal length/radius
- tangent
- concentric
- distance
- angle
- radius/diameter
- symmetry
- point-on-object
- other standard sketch relations

### Licensing

PlaneGCS source in FreeCAD is LGPL-2.1-or-later.

Keep it isolated behind `ISketchSolver`. Prefer building it as its own shared library/component so it can be replaced without changing the rest of the application.

## 5.2 Do not use SolveSpace's solver in a proprietary build by default

SolveSpace is GPLv3. Its library interface is useful, but GPL linkage is not appropriate if the intended application is closed-source unless a separate commercial licensing arrangement is obtained.

## 5.3 Long-term commercial option

Keep compatibility with replacing PlaneGCS by **Siemens D-Cubed 2D DCM** if the project later needs:

- commercial support
- industry-proven diagnostics
- more complete constraint inference
- advanced spline constraint handling

Do not couple UI code to PlaneGCS-specific types.

---

# 6. Secondary geometry components

## 6.1 Manifold

Use **Manifold** only for mesh-oriented functionality such as:

- imported mesh boolean operations
- mesh repair workflows
- guaranteed-manifold triangle output
- 3D-printing utilities
- mesh-only CSG fallback where B-Rep semantics do not apply

License: Apache-2.0.

Do **not** substitute Manifold for OCCT in the parametric B-Rep feature tree.

## 6.2 lib3mf

Use **lib3mf** for robust 3MF import/export.

3MF should be the preferred print-oriented mesh format.

Keep STL for compatibility, but do not treat STL as a lossless project format.

## 6.3 Existing browser-CAD projects to study, not blindly copy

### CascadeStudio / cascade-core

Study and reuse ideas from CascadeStudio:

- worker-isolated OpenCascade execution
- shape-to-mesh conversion
- modeling command wrappers
- selectors
- history
- automated browser testing

It currently demonstrates an OpenCascade 8 browser CAD stack and a reusable `cascade-core`.

Do not make it the canonical production kernel if the final architecture uses native OCCT.

### RepliCAD

Study its TypeScript abstraction over OpenCascade for:

- ergonomic API design
- selectors
- high-level operations
- worker architecture
- browser CAD integration

### JSketcher

Study its:

- parametric feature history
- sketch workflow
- constraint-solving UX
- face/edge propagation concepts

Do not copy JSketcher code into this product without explicit licensing review. Its license contains nonstandard contribution/upstream requirements and commercial licensing language.

---

# 7. Process architecture

Use three main runtime layers.

```text
┌─────────────────────────────────────────────────────────────┐
│ Electron Renderer                                          │
│ React UI + Three.js viewport                               │
│                                                             │
│ UI state / viewport state / interaction state              │
└──────────────────────┬──────────────────────────────────────┘
                       │ narrow preload API
                       ▼
┌─────────────────────────────────────────────────────────────┐
│ Electron Main                                              │
│ window lifecycle / filesystem dialogs / updater            │
│ sidecar lifecycle / security boundary / IPC routing        │
└──────────────────────┬──────────────────────────────────────┘
                       │ binary IPC
                       ▼
┌─────────────────────────────────────────────────────────────┐
│ cad-core native sidecar (C++17)                            │
│                                                             │
│ OCCT + OCAF + PlaneGCS + lib3mf + optional Manifold        │
│ feature graph / B-Rep / transactions / save/load           │
└─────────────────────────────────────────────────────────────┘
```

## Why a sidecar instead of a Node native addon

Do not embed the complete CAD kernel directly into the Electron renderer/main process with N-API as the primary architecture.

A sidecar gives:

- CAD crash isolation
- easier OCCT upgrades
- fewer Electron ABI problems
- independent debugging
- possible reuse by CLI/server tools
- cleaner language boundary
- ability to restart the geometry process and recover a document
- future headless rendering/testing

The sidecar should be an executable such as:

```text
intentcad-core.exe
```

Electron starts it with `child_process.spawn`.

---

# 8. IPC protocol

Use **FlatBuffers** with a small custom framed transport over stdin/stdout or named pipes.

Initial transport:

```text
uint32 little-endian payloadLength
uint8[payloadLength] FlatBuffer payload
```

Every request has:

```text
requestId
documentId
commandType
payload
```

Every response has:

```text
requestId
status
errorCode
errorMessage
modelDelta
meshPayloads[]
diagnostics[]
```

FlatBuffers is preferred because:

- C++ and TypeScript support
- low-overhead binary data
- schema evolution
- efficient mesh payloads
- Apache-2.0 license
- no heavy RPC runtime required

## Large mesh data

Mesh data must not be JSON.

Use typed binary arrays:

```text
positions: float32[]
normals:   float32[]
indices:   uint32[]
faceRanges: FaceRange[]
edgeVertices: float32[]
```

For very large models, add shared-memory transport later.

The protocol must be versioned from day one:

```text
protocolVersion = 1
```

---

# 9. Canonical model ownership

The native core owns:

- documents
- bodies
- sketches
- features
- parameters
- expressions
- persistent topology references
- OCAF labels
- B-Rep shapes
- feature dependency graph
- transaction history
- saved project state

The renderer owns only:

- active document ID
- camera
- hover
- current selection
- active tool
- temporary pointer state
- panels
- command palette
- UI preferences
- a read-only `ModelProjection`

Example projection:

```ts
interface ModelProjection {
  documentId: string;
  revision: number;
  rootItems: ModelTreeItem[];
  features: Record<string, FeatureSummary>;
  bodies: Record<string, BodySummary>;
  sketches: Record<string, SketchSummary>;
  parameters: Record<string, ParameterSummary>;
}
```

The frontend must never mutate the canonical graph locally and “hope” the backend matches.

---

# 10. Feature data model

Every feature requires a stable UUID.

Example:

```text
Document
├── Body UUID
│   ├── Feature: Box UUID
│   ├── Feature: Hole UUID
│   ├── Feature: Fillet UUID
│   └── Feature: Pattern UUID
└── Sketch UUID
```

Each feature conceptually contains:

```ts
type Feature = {
  id: UUID;
  type: FeatureType;
  name: string;
  enabled: boolean;
  parameters: Record<string, ParameterValue>;
  references: PersistentReference[];
  dependencies: UUID[];
  state: "ok" | "warning" | "error" | "suppressed";
  error?: FeatureError;
};
```

The actual canonical representation is stored in OCAF using standard attributes wherever practical.

Prefer standard OCAF attributes before inventing custom persistent attributes.

---

# 11. Parameter system

Parameters must support:

- millimeters as canonical internal linear unit
- radians as canonical internal angular unit
- UI unit conversion
- named variables
- expressions
- references to other parameters
- validation
- min/max constraints where appropriate

Example expressions:

```text
width = 120 mm
height = width / 2
holeSpacing = width - 20 mm
angle = 45 deg
```

Implement a small safe expression engine.

Do **not** use JavaScript `eval`.

Possible approach:

1. tokenize
2. parse expression AST
3. resolve named variables
4. unit-check expression
5. evaluate double value
6. dependency graph detects cycles

---

# 12. Undo/Redo

Use OCAF document transactions.

Mapping:

```text
pointer drag preview -> transient / abortable preview
pointer release       -> CommitCommand
Ctrl+Z                 -> OCAF Undo
Ctrl+Shift+Z           -> OCAF Redo
```

Each meaningful user action should create exactly one CAD transaction.

Examples:

- changing one dimension and pressing Enter -> one step
- dragging extrusion length from 30 to 80 mm -> one step
- AI creates “four holes in a rectangular pattern” -> either one compound transaction or an explicitly grouped transaction

Do not implement a second independent geometry undo stack in React.

---

# 13. Preview architecture

Preview must feel immediate.

For parameter drag:

1. capture committed feature state;
2. enter preview state;
3. update draft parameter;
4. compute a low-quality / coarse-tessellation preview;
5. display preview;
6. repeat while dragging, throttled;
7. on release:
   - validate;
   - commit one real transaction;
   - recompute final geometry;
   - generate high-quality tessellation;
8. on Escape:
   - discard preview;
   - restore committed geometry.

Target interaction latency:

- pointer feedback: `< 16 ms`
- simple feature preview: ideally `< 50 ms`
- common modeling preview: `< 150 ms`
- expensive operation: show progressive feedback rather than freezing UI

Never block the Electron renderer thread on geometry operations.

---

# 14. Tessellation and viewport mesh format

Use OCCT B-Rep as canonical geometry and tessellate for Three.js.

Use:

- `BRepMesh_IncrementalMesh`
- adaptive linear deflection
- angular deflection
- background final-quality remesh

Suggested model:

```text
Preview LOD:
  coarse triangulation
  fast update

Interactive LOD:
  normal working view

Export/inspection LOD:
  high-quality tessellation
```

The backend returns enough topology mapping for selection:

```ts
interface FaceRange {
  persistentFaceId: string;
  triangleStart: number;
  triangleCount: number;
}

interface EdgeRange {
  persistentEdgeId: string;
  vertexStart: number;
  vertexCount: number;
}
```

This is essential: a picked triangle must map back to a persistent CAD face.

---

# 15. Viewport interaction controller

Do not handle CAD pointer interactions as scattered React event handlers.

Create a central interaction state machine.

Example states:

```text
Idle
Hovering
Selecting
BoxSelecting
Orbiting
Panning
Zooming
DraggingManipulator
SketchDrawing
SketchDragging
CommandPreview
DimensionEditing
ContextMenu
TextEntry
```

Input priority must be explicit.

For example:

```text
active numeric input
    > manipulator drag
    > sketch entity drag
    > selection click
    > camera orbit
```

This prevents the common CAD problem where clicking a gizmo accidentally rotates the camera or edits a face.

---

# 16. Selection system

Selection modes:

- automatic/contextual
- body
- face
- edge
- vertex
- sketch entity

Default beginner behavior should be contextual, not a permanent “face mode / edge mode” toggle.

Hover rules:

- face: translucent highlight
- edge: thicker highlighted edge
- vertex: screen-space point
- body: outline

Use `three-mesh-bvh` for accelerated raycasting.

Use stable backend IDs in `userData`, never only scene-object indices.

---

# 17. Direct manipulation

Direct manipulation is the main beginner workflow.

Examples:

## Box

Dragging top face changes `height`.

Dragging right face changes `width`.

Dragging front face changes `depth`.

## Extrusion

Dragging terminal cap changes extrusion distance.

## Hole

Dragging radius handle changes diameter.

Dragging depth handle changes depth.

Dragging center handle repositions it in sketch plane.

## Fillet

Dragging a radius handle modifies radius.

### Critical rule

When a face was created by a known parametric feature, manipulation should modify the **source parameter**, not insert an arbitrary transform.

Example:

```text
User drags end face of ExtrudeFeature
```

Correct:

```text
ExtrudeFeature.distance = newDistance
recompute downstream graph
```

Wrong:

```text
translate selected face vertices
```

For imported/nonparametric geometry, direct-edit features can later be introduced explicitly.

---

# 18. Context-sensitive tools

The UI must expose only actions valid for the current context.

Example:

```text
Selection = planar face
```

Offer:

- Pull / Extrude
- Hole
- Sketch here
- Offset
- Measure
- Move face
- Shell from face
- Duplicate pattern if applicable

Selection = edge:

- Fillet
- Chamfer
- Measure
- select tangent chain
- select similar

Selection = body:

- Move
- Rotate
- Scale
- Duplicate
- Union
- Subtract
- Intersect
- Mirror
- Pattern

The command registry should determine availability.

---

# 19. Command Registry: central architecture

Define every operation once.

Example conceptual schema:

```ts
interface CadCommandDefinition<P> {
  id: string;
  label: string;
  description: string;
  icon: string;

  availability(ctx: CommandContext): AvailabilityResult;

  parameterSchema: ZodSchema<P>;
  selectionSchema: SelectionRequirement[];

  supportsPreview: boolean;
  beginnerVisible: boolean;
  advancedVisible: boolean;

  buildRequest(
    params: P,
    selection: PersistentSelection[]
  ): CoreCommandRequest;
}
```

The same registry drives:

- toolbar
- right-click menu
- command palette
- keyboard shortcut lookup
- “what can I do here?” suggestions
- AI tool definitions
- help/tutorial system
- plugin API

This avoids five implementations of the same operation.

---

# 20. Initial command set

Implement in this order.

## Tier 0 — foundation

- New document
- Open
- Save
- Save As
- Undo
- Redo
- Delete
- Rename
- Hide/show
- Isolate

## Tier 1 — primitives

- Box
- Cylinder
- Sphere
- Cone
- Torus
- Plane/reference plane

## Tier 2 — transforms

- Move
- Rotate
- Scale
- Duplicate
- Align
- Center
- Mirror

## Tier 3 — B-Rep operations

- Union / Fuse
- Subtract / Cut
- Intersect / Common
- Fillet
- Chamfer
- Shell
- Offset

## Tier 4 — sketch-based

- New sketch
- Line
- Polyline
- Rectangle
- Center rectangle
- Circle
- Arc
- Slot
- Polygon
- Trim
- Extend
- Offset sketch
- dimensions
- constraints
- Extrude
- Revolve

## Tier 5 — advanced feature modeling

- Hole feature
- linear pattern
- circular pattern
- mirror feature
- sweep
- loft
- ribs
- draft
- split body
- combine bodies

---

# 21. Sketch architecture

A sketch has its own local 2D coordinate system:

```text
origin
xAxis
yAxis
normal
supportReference
```

Sketch geometry is stored in local 2D coordinates.

Entities:

```text
Point
Line
Circle
Arc
Ellipse
Spline (later)
ConstructionLine
```

Constraints are independent objects with stable UUIDs.

## Interactive solving

While dragging a sketch point:

1. add a temporary drag target;
2. solve PlaneGCS;
3. receive solved coordinates;
4. update rendering;
5. do not persist temporary drag constraint;
6. on release, commit geometry position / inferred constraints.

## Constraint inference

Before AI, implement deterministic inference:

- near horizontal
- near vertical
- coincident point
- midpoint
- parallel
- perpendicular
- tangent
- concentric
- same radius
- symmetry
- equal length

Show inference as a temporary badge.

Only commit when user releases / confirms.

---

# 22. Dimensions

Dimensions are both:

- geometric constraints
- direct editing affordances

Render text in DOM overlay, not as low-resolution 3D text.

Workflow:

```text
click dimension label
type 125
Enter
```

The app:

1. parses value and unit;
2. applies parameter;
3. solves sketch/recomputes feature;
4. previews;
5. commits transaction.

Always show unit.

---

# 23. Camera UX

Default controls should be deliberately simpler than Blender.

Recommended baseline:

- drag empty background: orbit
- Shift + drag: pan
- wheel/pinch: zoom
- double click body: frame selection
- `F`: frame selection
- Home: frame all
- view cube: top/front/right/etc.
- optional perspective/orthographic toggle

Use a camera pivot that follows frame selection.

Keep a screen-space view cube in the corner.

Do not expose camera Euler angles to normal users.

---

# 24. Beginner UI

Default UI should contain roughly:

```text
┌─────────────────────────────────────────────────────────────┐
│ + Add   Modify   Measure                     Undo Redo Export│
├─────────────┬───────────────────────────────────────────────┤
│ Objects     │                                               │
│             │                                               │
│ Body        │                 VIEWPORT                      │
│ ├ Base      │                                               │
│ ├ Hole      │                                               │
│ └ Fillet    │                                               │
│             │                                               │
├─────────────┴───────────────────────────────────────────────┤
│ ✦ What do you want to do?                                  │
│ > Make two 8 mm holes 40 mm apart                          │
├─────────────────────────────────────────────────────────────┤
│ history: Base → Hole → Fillet                              │
└─────────────────────────────────────────────────────────────┘
```

No wall of 60 icons.

---

# 25. Progressive disclosure

UI levels:

```text
Simple
Advanced
```

Simple mode exposes intent-level operations.

Advanced mode adds:

- explicit sketches
- constraints
- construction geometry
- surface operations
- loft/sweep controls
- topology diagnostics
- tolerance controls
- reference geometry
- expression editor
- feature suppression
- detailed selection filters

Both modes manipulate the same document.

---

# 26. Object tree vs feature history

Do not blindly copy the traditional CAD tree.

Use two related concepts:

## Object tree

User-facing nouns:

```text
Desk
├ Legs
├ Top
└ Brackets
```

## Feature history

Creation logic:

```text
Box → Fillet → Hole → Pattern → Mirror
```

In simple mode, feature history can be visually compact.

In advanced mode, expose the full feature dependency data.

---

# 27. Intent inference without AI

Build a deterministic `IntentEngine`.

Inputs:

- current selection
- hovered geometry
- drag vector
- pointer screen direction
- nearby geometry
- current active command
- model symmetry
- repeated prior actions
- snap candidates
- operation context

Outputs:

```ts
type IntentSuggestion =
  | AlignSuggestion
  | ConcentricSuggestion
  | EqualSizeSuggestion
  | PatternSuggestion
  | SymmetrySuggestion
  | ThroughAllSuggestion
  | MergeSuggestion;
```

Example:

```text
Two holes created with almost identical diameter
→ Suggest: "Keep these holes the same size?"
```

This must work offline with no LLM.

---

# 28. AI / natural-language layer

Implement only after the deterministic command system is stable.

The LLM never receives unrestricted authority.

Architecture:

```text
User text
   ↓
Intent context builder
   ↓
LLM
   ↓
typed tool calls / command plan
   ↓
schema validation
   ↓
preview
   ↓
user confirm or direct commit for safe reversible action
   ↓
native core
```

## Context given to AI

Provide structured information, not a giant raw mesh.

Example:

```json
{
  "selection": [
    {
      "kind": "face",
      "id": "face-ref-...",
      "surface": "plane",
      "body": "body-..."
    }
  ],
  "model": {
    "bodies": 1,
    "selectedBody": {
      "dimensionsApprox": [120, 80, 20]
    }
  },
  "availableCommands": [
    "CreateHole",
    "Extrude",
    "Fillet",
    "SetDimension"
  ],
  "units": "mm"
}
```

## AI output example

```json
{
  "commands": [
    {
      "type": "CreateHole",
      "targetFace": "face-ref-...",
      "diameter": 8,
      "depthMode": "throughAll",
      "position": {
        "x": 20,
        "y": 20
      }
    }
  ]
}
```

Validate every field.

Unknown target IDs are rejected.

## Provider abstraction

Create:

```ts
interface IntentModelProvider {
  plan(request: IntentRequest): Promise<IntentPlan>;
}
```

Possible providers:

- local OpenAI-compatible endpoint
- user's local LLM server
- hosted OpenAI-compatible provider
- other cloud provider

The CAD application must not require cloud access.

---

# 29. “Create from reference” roadmap

Later add image/PDF/sketch reference workflows.

Possible stages:

## Stage A

Import image as calibrated background plane.

User clicks two points and enters real distance.

## Stage B

Computer vision extracts:

- straight edges
- circles
- dominant dimensions
- perspective axes

## Stage C

Vision-capable AI proposes a feature plan.

Example:

```text
Detected:
- rectangular base
- vertical plate
- 2 circular holes
- likely symmetry

Proposed editable build:
1. Box/base extrusion
2. Vertical extrusion
3. Two-hole pattern
4. Fillet
```

Never convert an image directly into an opaque mesh if the intention is editable CAD.

---

# 30. Project file format

Use a custom extension such as:

```text
.icad
```

It should be a ZIP container.

Example:

```text
project.icad
├── manifest.json
├── document.xbf
├── ui-state.json
├── thumbnail.webp
├── assets/
│   ├── reference-01.png
│   └── imported-model.step
└── recovery/
```

`document.xbf` is the canonical OCAF binary document (`BinXCAF` or an appropriate OCAF binary format).

`manifest.json`:

```json
{
  "format": "intentcad-project",
  "schemaVersion": 1,
  "appVersion": "0.1.0",
  "createdAt": "...",
  "modifiedAt": "...",
  "documentId": "...",
  "units": "mm"
}
```

Do not save the authoritative feature graph twice in both JSON and OCAF.

JSON contains package metadata, not a second source of truth.

---

# 31. Autosave and crash recovery

Implement a recovery journal outside the normal project file.

Suggested location:

```text
userData/recovery/<document-uuid>/
```

Store:

- last committed project snapshot
- append-only high-level command journal since snapshot
- current app/version metadata

On startup after crash:

```text
Recovered unsaved document from 14:32
[Open recovery] [Discard]
```

Do not rewrite a multi-hundred-MB project ZIP on every pointer change.

---

# 32. Import/export

## CAD

Use OCCT for:

- STEP
- IGES
- BREP

STEP is the primary external solid-CAD exchange format.

## 3D printing / mesh

Use:

- 3MF — preferred
- STL — compatibility
- OBJ — compatibility
- glTF/GLB — visualization/material workflows

Use lib3mf for 3MF.

## 2D

Support later:

- DXF
- SVG

For initial simple DXF sketch export, implementing a small explicit ASCII DXF subset may be cleaner than importing a large dependency.

---

# 33. Assemblies

Do not attempt full SolidWorks-style assembly constraints in the first release.

Prepare the data model for:

```text
Document
├ Parts
└ AssemblyInstances
```

Each instance:

```text
partReference
transform
visibility
appearance
```

Later add:

- mate
- concentric
- coincident
- distance
- angle
- rigid group

A future commercial-quality assembly solver could use D-Cubed 3D DCM or a dedicated internal solver.

---

# 34. Materials and rendering

V1 materials are visual, not physically authoritative.

Store:

- base color
- roughness
- metalness
- opacity

Use simple CAD lighting:

- environment light
- key light
- subtle shadows
- optional ambient occlusion
- edge overlay

Do not build a Blender-class material/node editor.

---

# 35. UI state management

Use Zustand stores separated by concern.

Example:

```text
useDocumentUiStore
useSelectionStore
useViewportStore
useToolStore
usePreferencesStore
useCommandPaletteStore
```

Never create one gigantic global store.

Model data from the core should be managed as immutable snapshots/deltas keyed by `documentRevision`.

---

# 36. Frontend folder structure

Suggested:

```text
apps/desktop/
├ src/
│  ├ app/
│  ├ components/
│  ├ commands/
│  ├ features/
│  ├ interaction/
│  ├ model/
│  ├ stores/
│  ├ viewport/
│  │  ├ CadViewport.ts
│  │  ├ CameraController.ts
│  │  ├ SelectionRenderer.ts
│  │  ├ GizmoSystem.ts
│  │  ├ GridRenderer.ts
│  │  ├ SketchRenderer.ts
│  │  ├ DimensionOverlay.tsx
│  │  └ PickingSystem.ts
│  ├ intent/
│  ├ ipc/
│  └ styles/
├ electron/
│  ├ main.ts
│  ├ preload.ts
│  ├ sidecar.ts
│  └ updater.ts
└ tests/
```

---

# 37. Native core folder structure

```text
native/cad-core/
├ CMakeLists.txt
├ vcpkg.json
├ src/
│  ├ main/
│  ├ protocol/
│  ├ document/
│  ├ model/
│  ├ features/
│  │  ├ primitives/
│  │  ├ booleans/
│  │  ├ sketch/
│  │  ├ extrusion/
│  │  ├ revolve/
│  │  ├ fillet/
│  │  ├ chamfer/
│  │  ├ hole/
│  │  ├ pattern/
│  │  ├ mirror/
│  │  ├ loft/
│  │  └ sweep/
│  ├ topology/
│  ├ tessellation/
│  ├ constraints/
│  ├ import_export/
│  ├ persistence/
│  ├ validation/
│  └ diagnostics/
└ tests/
```

---

# 38. Monorepo layout

Use pnpm workspaces.

```text
intentcad/
├ apps/
│  └ desktop/
├ native/
│  └ cad-core/
├ packages/
│  ├ protocol/
│  ├ command-schema/
│  ├ units/
│  └ plugin-sdk/
├ schemas/
│  └ cad_protocol.fbs
├ docs/
├ scripts/
├ pnpm-workspace.yaml
└ README.md
```

Do not put native build artifacts in source folders.

---

# 39. Dependency management

## JavaScript

Use `pnpm`.

Commit:

```text
pnpm-lock.yaml
```

Pin major versions deliberately.

## C++

Use `vcpkg` manifest mode with a committed baseline.

Desired packages include:

```text
opencascade
flatbuffers
lib3mf
manifold
gtest
```

Enable only required OCCT features.

Prefer shared OCCT libraries for licensing and build flexibility.

---

# 40. Threading rules

The renderer thread must never execute CAD operations.

Native core:

- one serialized mutation queue per document;
- background work allowed for operations proven independent;
- tessellation can use worker jobs;
- avoid concurrent mutation of the same OCAF document;
- serialize any OCCT import/export paths documented as not thread-safe.

Keep cancellation tokens for expensive tasks.

Example:

```cpp
JobId startRecompute(...);
cancel(JobId);
```

When the user changes a parameter repeatedly, cancel or obsolete earlier preview recomputations.

---

# 41. Geometry validation

After every committed feature:

1. check operation status;
2. validate resulting shape with OCCT shape validation;
3. reject null/empty invalid result where appropriate;
4. capture diagnostics;
5. never silently replace failed geometry with a fake mesh.

Model feature states:

```text
OK
WARNING
ERROR
SUPPRESSED
```

Error UI must say something actionable, for example:

```text
Fillet could not be created at 20 mm.
Maximum stable value appears to be approximately 13.4 mm.
```

Where practical, binary-search a safe parameter range for friendlier errors.

---

# 42. Geometric tolerance policy

Centralize tolerances.

Never scatter constants such as:

```cpp
1e-6
0.0001
0.01
```

through the codebase.

Create:

```cpp
struct GeometryTolerancePolicy {
    double linearModelTolerance;
    double angularTolerance;
    double coincidenceTolerance;
    double selectionTolerancePx;
};
```

Separate:

- model-space tolerance
- numerical kernel tolerance
- UI snapping tolerance
- screen-space picking tolerance

---

# 43. Units

Internal canonical units:

- length: millimeter
- angle: radian
- mass: kilogram only when mass properties are added

User may display:

- mm
- cm
- m
- inch

All IPC numeric geometry should use explicit documented units.

Do not infer units from locale.

---

# 44. Performance targets

Reasonable V1 target machine:

- modern 4+ core CPU
- 8 GB RAM minimum
- integrated or discrete GPU supporting WebGL2

Targets:

- startup shell visible in under a few seconds
- empty viewport 60 FPS
- normal orbiting 60 FPS
- hover picking under ~16 ms
- simple feature recompute under ~100 ms
- 100k–500k triangle working models interactive
- large STEP imports progressively displayed when possible

Do not promise arbitrary industrial assembly size in V1.

---

# 45. Rendering performance rules

1. Do not create one Three.js object per triangle.
2. Batch faces by body/material where possible.
3. Keep face-ID mappings as ranges/attributes.
4. Rebuild BVH only for changed body meshes.
5. Avoid React rerenders from pointer-move events.
6. Reuse materials.
7. Dispose GPU resources explicitly.
8. Use adaptive edge rendering.
9. Use requestAnimationFrame only when scene needs continuous update; otherwise allow demand rendering.
10. Keep DOM overlays limited and virtualized where necessary.

---

# 46. Accessibility and input

Support:

- mouse
- trackpad
- keyboard
- touch/pen architecture later

Keyboard shortcuts must be remappable.

Do not make important commands accessible only through right click.

Numeric input should work without requiring pointer precision.

---

# 47. Plugin architecture

Do not expose arbitrary native C++ loading in V1.

Start with sandboxed JS/TS plugins.

Plugins can register:

- commands
- panels
- import/export adapters
- generators
- analysis tools

Plugin cannot directly access filesystem or native core unless capability granted.

Example:

```ts
intentcad.registerCommand({
  id: "plugin.gear.create",
  parameterSchema: ...,
  execute: async (ctx, params) => {
    return ctx.core.invoke("CreateGear", params);
  }
});
```

Eventually support native plugins only with a strict stable C ABI or process boundary.

---

# 48. Security

Renderer:

```text
nodeIntegration = false
contextIsolation = true
sandbox = true
```

Preload exposes only typed APIs.

Never expose:

```text
fs
child_process
shell arbitrary URL execution
```

directly to renderer.

Validate all IPC.

For AI:

- never allow model output to execute JavaScript/C++/shell;
- only permit registered commands;
- validate command schema;
- require explicit capability for filesystem/network operations.

---

# 49. Testing strategy

## C++ unit tests

Use GoogleTest.

Test every feature with:

- known dimensions
- bounding box
- volume when predictable
- face/edge counts only where stable and meaningful
- shape validity
- expected failure cases

## Topology regression tests

Mandatory.

Example:

```text
1. Create box
2. Select top face persistently
3. Add hole referenced to top face
4. Change box width
5. Recompute
6. Hole must remain on intended top face
```

Add dozens of these.

## Constraint solver tests

Test:

- under-constrained
- fully constrained
- over-constrained
- conflicting
- drag behavior
- inferred constraints

## Frontend tests

Use:

- Vitest
- React Testing Library

## E2E

Use Playwright against Electron.

Tests must cover:

- create primitive
- select face
- pull face / change parameter
- add hole
- Undo/Redo
- save
- reopen
- geometry identical after reopen
- export STEP/3MF

## Geometry fuzzing

Add later:

- randomized boxes/cylinders
- boolean combinations
- fillet radii
- offsets

Crash in the CAD core must be treated as a critical test failure.

---

# 50. Logging and diagnostics

Use structured logs.

Core logs:

```text
time
documentId
requestId
featureId
operation
durationMs
OCCT status
result
```

UI has a hidden diagnostics window.

On geometry failure allow export of a debug bundle containing:

```text
app version
OS
GPU info
command journal
feature graph summary
core log
problematic BREP if privacy allows and user explicitly chooses
```

---

# 51. Crash isolation

Because CAD kernel runs in a sidecar:

1. Electron detects process exit.
2. UI freezes model editing, not entire application.
3. display:
   - “Geometry engine stopped unexpectedly.”
4. automatically restart core.
5. restore latest autosave + command journal.
6. rehydrate viewport.

The app should survive a native kernel crash whenever recovery data is valid.

---

# 52. File compatibility/version migration

Every `.icad` file has:

```text
schemaVersion
```

Implement migrations:

```text
v1 -> v2
v2 -> v3
```

Never mutate a user file in-place before a backup during a breaking migration.

Provide “Save upgraded copy”.

---

# 53. Feature recomputation graph

Features form a DAG.

Example:

```text
SketchA
  ↓
ExtrudeA
  ↓
FilletA
  ↓
HoleA
```

Changing `SketchA.width`:

1. mark `SketchA` dirty;
2. mark descendants dirty;
3. recompute in topological order;
4. stop/mark downstream error if parent fails;
5. preserve last valid display optionally with an error badge.

Do not recompute unrelated bodies.

---

# 54. Dirty-state granularity

Track:

```text
GeometryDirty
TessellationDirty
AppearanceDirty
MetadataDirty
ViewportOnlyDirty
```

Changing body color should not recompute B-Rep.

Changing camera should not call native core.

---

# 55. Naming user-facing operations

Beginner UI terms:

Traditional CAD term | Beginner term
---|---
Extrude | Pull / Give height
Boolean Fuse | Combine
Boolean Cut | Cut / Subtract
Boolean Common | Keep overlap
Constraint | Keep relation
Coincident | Join points
Concentric | Same center
Pattern | Repeat
Shell | Hollow
Chamfer | Cut corner
Fillet | Round edge

Advanced mode may display canonical CAD terminology in secondary text.

---

# 56. First-time-use workflow

No mandatory tutorial video.

On empty document:

```text
What do you want to create?

[Start from a box]
[Start from a cylinder]
[Draw a shape]
[Import a model]
[Describe it]
```

Then contextual coaching.

Example:

```text
Drag a face to change its size.
Click the number to type an exact value.
```

Dismiss once learned.

Store learned hints locally.

---

# 57. Command bar

At bottom or top:

```text
✦ What do you want to do?
```

It supports both deterministic commands and AI.

Examples:

```text
box 100 50 20
hole 8
fillet 3
front view
export step
```

For simple syntax, parse locally without LLM.

Only send genuinely natural-language requests to the AI provider.

This reduces latency and cost.

---

# 58. Natural-language safety/UX

AI plans should be previewable.

For ambiguous request:

```text
"Make the hole bigger"
```

If exactly one hole is selected:

- propose the selected hole.

If multiple holes could match:

- highlight candidates and ask through the UI, not a generic chat conversation.

The CAD viewport should be the primary clarification interface.

---

# 59. Recommended initial dependency shortlist

Frontend:

```text
react
react-dom
three
three-mesh-bvh
zustand
xstate (optional but recommended for interaction state)
zod
@radix-ui/*
lucide-react
@floating-ui/react
tailwindcss
```

Desktop:

```text
electron
electron-forge or equivalent maintained packaging stack
```

Testing:

```text
vitest
@testing-library/react
playwright
```

Native:

```text
OpenCascade 8.0.1
FlatBuffers
PlaneGCS source/component
lib3mf
Manifold
GoogleTest
```

Avoid adding dependencies unless they solve a real problem.

---

# 60. Components explicitly rejected as primary foundations

## OpenCascade.js as production canonical kernel

Useful for prototypes and web builds, but not the preferred final desktop architecture because native OCCT provides:

- unrestricted native memory model
- easier access to full C++ API
- fewer WASM binding gaps
- better path for very large models
- cleaner OCAF integration
- easier native profiling/debugging

Keep a backend abstraction so a WASM edition could exist later.

## Pure mesh CSG

Not acceptable as the main CAD representation.

It destroys exact B-Rep semantics and makes STEP-quality editable CAD much harder.

## Full custom geometry kernel

Not justified.

Years of work would be spent recreating solved problems before reaching product differentiation.

## SolveSpace solver by default

GPLv3 licensing creates a problem for closed-source commercial distribution.

## JSketcher as the app foundation

Useful research material, but its licensing and maintenance history make it unsuitable as the base of this product without explicit agreement.

---

# 61. Build phases

## Phase 0 — bootstrap

Deliver:

- monorepo
- Electron window
- React UI
- Three.js viewport
- native C++ sidecar
- FlatBuffers ping/pong
- CI build on Windows
- unit test harness

Acceptance:

- desktop app starts;
- sidecar starts;
- renderer can request core version;
- clean shutdown;
- crash detection works.

---

## Phase 1 — B-Rep primitive loop

Deliver:

- new document
- box/cylinder/sphere
- OCCT B-Rep
- tessellation
- mesh binary IPC
- Three.js rendering
- orbit/pan/zoom
- body selection
- save/open OCAF document

Acceptance:

- box dimensions entered in UI produce exact OCCT geometry;
- save/reopen returns same solid;
- no geometry is generated in Three.js itself except display helpers.

---

## Phase 2 — topology-aware selection

Deliver:

- face/edge/vertex picking
- triangle-to-face mapping
- edge mapping
- persistent selection references
- TNaming setup
- topology regression tests

Acceptance:

- selected face references survive parameter changes in at least the foundational feature cases.

Do not proceed to large feature count before this is solid.

---

## Phase 3 — feature graph + parameters

Deliver:

- feature DAG
- dirty propagation
- OCAF transactions
- Undo/Redo
- typed command registry
- dimension editing
- primitive direct manipulation

Acceptance:

- drag box face -> dimension changes -> downstream feature recomputes -> one Undo step.

---

## Phase 4 — sketches

Deliver:

- sketch plane
- lines/circles/arcs/rectangles
- PlaneGCS
- basic constraints
- dimensions
- snapping/inference
- sketch drag
- extrusion
- revolve

Acceptance:

A first-time tester should be able to create a dimensioned plate with holes without reading documentation.

---

## Phase 5 — core solid features

Deliver:

- boolean union/cut/common
- hole feature
- fillet
- chamfer
- shell
- mirror
- linear pattern
- circular pattern
- loft
- sweep

Acceptance:

- all operations represented as editable features;
- reference failures become explicit diagnostic states;
- no silent geometry corruption.

---

## Phase 6 — beginner interaction layer

Deliver:

- face pull
- context toolbar
- visual dimensions
- view cube
- selection suggestions
- “select similar”
- align/center suggestions
- adaptive UI
- Simple/Advanced mode

Acceptance:

Run usability tests with users who have never used CAD.

Measure:

- time to create first exact-size object;
- number of incorrect clicks;
- number of terms they had to learn;
- successful task completion without tutorial.

---

## Phase 7 — natural-language commands

Deliver:

- command bar
- local parser for deterministic short commands
- AI provider abstraction
- structured tool calls
- plan validation
- visual preview
- selected-object context

Acceptance:

```text
"Create a 100 x 60 x 10 plate and make four 6 mm holes 8 mm from the corners"
```

produces an editable feature tree rather than one baked mesh.

---

## Phase 8 — professional hardening

Deliver:

- STEP import/export
- 3MF
- STL
- OBJ/glTF
- large-model optimization
- recovery journal
- signed updater
- license notices
- telemetry only if explicitly enabled
- crash bundle
- more topology regression tests

---

# 62. UX acceptance scenarios

The coding agent must continuously test the product against these scenarios.

## Scenario A — absolute beginner

User wants a 100 × 50 × 10 mm block with an 8 mm hole.

Expected path:

1. Add Box
2. drag/type dimensions
3. click face
4. click Hole
5. click position
6. type 8
7. choose Through
8. done

The user must not need to understand:

- sketches
- boolean cut
- body mode
- face indexes
- B-Rep

## Scenario B — intermediate user

User wants a symmetric bracket.

Expected:

- sketch becomes available
- inferred perpendicular/symmetry constraints
- exact dimensions
- extrude
- holes/pattern
- fillets

## Scenario C — advanced user

User can expose:

- full feature tree
- explicit constraints
- expressions
- reference geometry
- detailed parameters
- topology diagnostics

---

# 63. Coding rules for the agent

## Mandatory

1. Compile and run tests after each meaningful implementation chunk.
2. Keep commits/features small and independently testable.
3. No placeholder geometry pretending to be a completed CAD operation.
4. No hardcoded fake data in production paths.
5. No persisted face/edge indices.
6. No direct Node APIs in renderer.
7. No synchronous CAD calls on renderer thread.
8. No giant “god classes”.
9. No duplicated source of truth between C++ and React.
10. Every IPC message is versioned and validated.
11. Every new modeling feature gets:
    - backend test,
    - failure test,
    - save/reload test where relevant,
    - topology reference regression test where relevant.
12. Use RAII in C++.
13. Treat OCCT handles/shapes carefully; no hidden lifetime assumptions.
14. Dispose Three.js GPU resources.
15. Include performance instrumentation around geometry operations.

## Do not over-engineer V1

Do not build yet:

- cloud collaboration
- animation
- ray-traced rendering
- FEM
- CAM toolpaths
- full assemblies
- sculpt mode
- node-based materials
- cloud accounts

First make solid modeling exceptional.

---

# 64. First implementation tasks for the coding agent

Start with exactly this order.

### Task 1

Create monorepo structure.

### Task 2

Create Electron + React + TypeScript + Vite application.

### Task 3

Create empty Three.js viewport with camera controller.

### Task 4

Create `cad-core` C++ executable with CMake/vcpkg.

### Task 5

Link OCCT 8.0.1.

### Task 6

Implement FlatBuffers transport and `GetCoreInfo`.

### Task 7

Implement `CreateDocument`.

### Task 8

Implement `CreateBox(width,height,depth)` in native core.

### Task 9

Tessellate box and send binary mesh to frontend.

### Task 10

Render it and implement body hover/select.

### Task 11

Add OCAF persistence and Save/Open.

### Task 12

Add face/edge mapping and persistent references.

Only after Task 12 is reliable should feature count expand rapidly.

---

# 65. Suggested initial command protocol

Conceptual FlatBuffers schema:

```fbs
namespace IntentCad.Protocol;

enum CommandType : ushort {
  None,
  GetCoreInfo,
  CreateDocument,
  CreateBox,
  SetFeatureParameter,
  DeleteFeature,
  Undo,
  Redo,
  SaveDocument,
  OpenDocument,
  RequestMesh
}

table Vec3 {
  x: double;
  y: double;
  z: double;
}

table CreateBoxCommand {
  featureId: string;
  widthMm: double;
  heightMm: double;
  depthMm: double;
  origin: Vec3;
}

table CommandEnvelope {
  protocolVersion: uint;
  requestId: string;
  documentId: string;
  type: CommandType;
  // Use a FlatBuffers union for payload in real schema.
}

root_type CommandEnvelope;
```

Do not stop at this simplified schema; implement proper unions and response types.

---

# 66. Model delta protocol

Do not resend the entire document tree after every operation.

Return deltas:

```ts
type ModelDelta = {
  revision: number;
  added: EntitySummary[];
  updated: EntitySummary[];
  removedIds: string[];
  changedMeshes: MeshUpdate[];
  selectionRemaps?: SelectionRemap[];
};
```

Renderer applies only if:

```text
delta.baseRevision == currentRevision
```

If revisions diverge, request a full snapshot.

---

# 67. Interaction between core and rendering

The C++ core must have no Three.js awareness.

It returns render-neutral geometry buffers and semantic IDs.

Three.js code must have no OCCT headers/types.

Boundary:

```text
OCCT Shape
   ↓
Tessellator
   ↓
RenderMesh DTO
   ↓ FlatBuffers
Three.js BufferGeometry
```

This separation is mandatory.

---

# 68. Direct manipulation metadata

Feature evaluators should expose manipulator descriptors.

Example:

```json
{
  "featureId": "extrude-uuid",
  "manipulators": [
    {
      "id": "distance",
      "type": "linear",
      "axis": [0, 0, 1],
      "parameter": "distance",
      "originReference": "cap.end"
    }
  ]
}
```

This allows the frontend to create correct handles without hardcoding every operation into viewport logic.

Similarly:

```json
{
  "featureId": "hole-uuid",
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

This is a key architectural choice.

---

# 69. Context action metadata

Core/command registry can expose:

```text
selected planar face
→ sketch
→ hole
→ pull
→ offset
→ measure
```

The UI should not maintain a giant independent if/else table.

---

# 70. Why this architecture fits the product vision

The product differentiator is not the kernel.

OCCT solves exact geometry.

PlaneGCS solves geometric constraints.

Three.js solves display.

Electron solves desktop distribution.

React solves flexible UI.

The unique layer should be:

```text
human intent
    ↓
context-sensitive interaction
    ↓
direct manipulation
    ↓
typed semantic command
    ↓
parametric feature graph
    ↓
real CAD kernel
```

That is where engineering effort should be concentrated.

---

# 71. Verification of the architecture

## Question 1

Can a complete beginner use the app without knowing “extrude”?

**Yes**, because dragging a face changes the source feature parameter and beginner labels can say “Pull”.

## Question 2

Does simplifying the UI destroy parametric editability?

**No**, because simplification exists only above the feature graph.

## Question 3

Can an advanced user later access explicit sketches/constraints?

**Yes**, because the simple and advanced modes share the same underlying model.

## Question 4

Can AI corrupt geometry by hallucinating vertices?

**Not if this specification is followed**, because AI may only emit validated registered commands.

## Question 5

Will face references survive all possible topology changes perfectly?

**No CAD system can assume that.** OCAF/TNaming plus semantic fallback and explicit repair UX substantially reduce failures, but ambiguous topology changes must still be handled honestly.

## Question 6

Is WebAssembly enough for a prototype?

**Yes.** CascadeStudio/RepliCAD prove it is practical.

## Question 7

Why not use WASM as the only production architecture?

Because a native desktop CAD core provides a safer path for:

- memory-heavy files
- complete OCCT access
- OCAF integration
- native debugging
- future advanced features
- avoiding gaps in generated bindings

## Question 8

Why not use a fully native Qt UI?

It is valid technically, but it slows the specific product-development loop compared with React/Electron and introduces additional licensing/UX-tooling tradeoffs.

---

# 72. Revised final recommendation

Build the application as a **hybrid native/web desktop CAD**:

```text
Electron 44
React 19.3
TypeScript
Vite 8.1+
Tailwind 4
Three.js
three-mesh-bvh
        │
        │ FlatBuffers
        ▼
C++17 native cad-core
OpenCascade 8.0.1
OCAF / TNaming / XCAF
PlaneGCS
lib3mf
Manifold (mesh subsystem only)
```

The most important engineering priorities are, in order:

1. persistent topology
2. clean feature graph
3. transaction/Undo architecture
4. fast preview pipeline
5. selection and direct manipulation
6. sketch solver
7. context-aware command registry
8. beginner UX
9. AI layer
10. advanced/pro features

If these are reversed and AI/UI is built before topology and feature recomputation are correct, the app will look impressive early but become structurally brittle.

---

# 73. Research references

These are the primary sources used when choosing the architecture.

## OpenCascade / OCAF

- Open CASCADE Technology repository and licensing:  
  https://github.com/Open-Cascade-SAS/OCCT
- OCCT releases, including 8.0.1:  
  https://github.com/Open-Cascade-SAS/OCCT/releases
- OCAF architecture, transactions, persistence and topological naming:  
  https://github.com/Open-Cascade-SAS/OCCT/wiki/ocaf
- OCCT documentation:  
  https://dev.opencascade.org/doc/overview/html/

## Electron / desktop shell

- Electron documentation:  
  https://www.electronjs.org/docs/latest/
- Electron process model:  
  https://www.electronjs.org/docs/latest/tutorial/process-model
- Electron release information:  
  https://releases.electronjs.org/

## Tauri comparison

- Tauri architecture:  
  https://v2.tauri.app/concept/architecture/
- Tauri platform webview versions:  
  https://v2.tauri.app/reference/webview-versions/

## Qt comparison

- Qt licensing:  
  https://doc.qt.io/qt-6/licensing.html
- Qt 6.11 information:  
  https://www.qt.io/blog/qt-6.11-released

## Constraint solving

- FreeCAD PlaneGCS source:  
  https://github.com/FreeCAD/FreeCAD/tree/main/src/Mod/Sketcher/App/planegcs
- PlaneGCS standalone wrapper research:  
  https://github.com/spookylukey/planegcs
- SolveSpace library/licensing information:  
  https://solvespace.github.io/solvespace-web/library.html
- Siemens D-Cubed 2D DCM:  
  https://www.siemens.com/en-us/products/plm-components/d-cubed/

## Browser CAD references

- OpenCascade.js:  
  https://github.com/donalffons/opencascade.js
- CascadeStudio / cascade-core:  
  https://github.com/zalo/CascadeStudio
- RepliCAD:  
  https://github.com/sgenoud/replicad
- JSketcher:  
  https://github.com/xibyte/jsketcher

## Rendering

- Three.js:  
  https://threejs.org/
- three-mesh-bvh:  
  https://github.com/gkjohnson/three-mesh-bvh
- Babylon.js WebGPU reference used for comparison:  
  https://github.com/BabylonJS/Documentation/blob/master/content/setup/support/webGPU.md

## IPC

- FlatBuffers:  
  https://flatbuffers.dev/
- FlatBuffers repository:  
  https://github.com/google/flatbuffers

## Mesh / 3D printing

- Manifold:  
  https://github.com/elalish/manifold
- lib3mf:  
  https://github.com/3MFConsortium/lib3mf

## Frontend

- React versions:  
  https://react.dev/versions
- Vite 8:  
  https://vite.dev/blog/announcing-vite8
- Tailwind CSS:  
  https://tailwindcss.com/docs/

---

# 74. Final instruction to the coding agent

Treat this document as the architecture contract.

When an implementation choice conflicts with this document:

1. preserve B-Rep correctness;
2. preserve persistent topology;
3. preserve one source of truth;
4. preserve command/transaction semantics;
5. preserve UI responsiveness;
6. only then optimize for implementation convenience.

Do not “simplify” by replacing architectural requirements with a mesh-only prototype unless the work is explicitly on a throwaway experiment branch.

The application should become easy for the user because **complexity is absorbed by the software**, not because precision or model structure is removed.
