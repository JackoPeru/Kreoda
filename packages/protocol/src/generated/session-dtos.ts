// Generated from schemas/session-control-v1.json. Do not edit.
// Source SHA256: fc27989e6b39fd8d12cafa770f72ab89f26e7bb0f9d14b635f687b3ebbdfe6ce
type StableFeatureID = string;

export interface RequestMetadata {
    operationId?: string;
    sessionId?:   string;
    [property: string]: unknown;
}

export interface HelloParams {
    capabilities?:   string[];
    clientId?:       string;
    clientName?:     string;
    clientType?:     string;
    deviceId?:       string;
    protocolVersion: number;
    token:           string;
    [property: string]: unknown;
}

export interface SnapshotParams {
    documentId?: string;
    [property: string]: unknown;
}

export interface RequestMeshLODParams {
    bodyId:           string;
    documentId:       string;
    expectedRevision: number;
    instanceId?:      string;
    quality:          number;
}

export interface MeshReply {
    result: MeshHeader;
}

export interface MeshHeader {
    bodyId:          string;
    byteLength:      number;
    documentId:      string;
    featureId:       string;
    instanceId?:     string;
    nativeRequestId: string;
    quality:         number;
    revision:        number;
    sessionId:       string;
    tipId:           string;
}

export interface InvokeParams {
    baseRevision?:  number | null;
    documentId?:    string;
    fields?:        { [key: string]: unknown };
    transactionId?: string;
    type:           number;
    [property: string]: unknown;
}

export interface NamedCommandParams {
    baseRevision?:  number | null;
    commandId:      string;
    documentId?:    string;
    featureId?:     string;
    parameters?:    { [key: string]: unknown };
    transactionId?: string;
    [property: string]: unknown;
}

export interface TxnParams {
    documentId?:   string;
    transactionId: string;
    [property: string]: unknown;
}

export interface ErrorReply {
    error:     string;
    errorCode: string;
    ok:        boolean;
    requestId: string;
    [property: string]: unknown;
}

export interface SessionRequestEnvelope {
    method:       string;
    operationId?: string;
    params?:      { [key: string]: unknown };
    requestId:    string;
    sessionId?:   string;
    [property: string]: unknown;
}

export interface HelloReply {
    capabilities: string[];
    clientId:     string;
    deviceId?:    string;
    documentId:   string;
    ok:           boolean;
    requestId:    string;
    revision:     number;
    sessionId:    string;
    [property: string]: unknown;
}

export interface SessionSnapshotPayload {
    bodies:     BodyDescriptor[];
    datums?:    DatumDescriptor[];
    documentId: string;
    features:   FeatureDescriptor[];
    revision:   number;
    sessionId:  string;
    sketches:   SketchDescriptor[];
    tips?:      string[];
    [property: string]: unknown;
}

export interface BodyDescriptor {
    bodyId:  string;
    history: string[];
    tip:     string;
    [property: string]: unknown;
}

export interface DatumDescriptor {
    definition: DatumDefinition;
    dependsOn:  string[];
    error?:     string;
    featureId:  string;
    kind:       DatumDescriptorKind;
    resolved:   DatumGeometry;
    status:     Status;
    type?:      DatumDescriptorKind;
    [property: string]: unknown;
}

export interface DatumDefinition {
    planeKind?:  PlaneKind;
    type:        DefinitionType;
    base?:       Base;
    offsetMm?:   number;
    first?:      DefinitionFirst;
    second?:     DefinitionSecond;
    angleDeg?:   number;
    axis?:       AxisClass;
    third?:      Third;
    plane?:      Plane;
    through?:    Through;
    positionMm?: [number, number, number, ...number[]];
}

export interface AxisClass {
    axis?:             AxisEnum;
    type:              AxisType;
    featureId?:        string;
    persistentEdgeId?: string;
    selectionEntry?:   string;
}

export type AxisEnum = "X" | "Y" | "Z";

export type AxisType = "principal" | "datum" | "edge";

export interface Base {
    planeKind?:        PlaneKind;
    type:              BaseType;
    featureId?:        string;
    persistentFaceId?: string;
    selectionEntry?:   string;
}

export type PlaneKind = "XY" | "XZ" | "YZ";

export type BaseType = "principal" | "datum" | "face";

export interface DefinitionFirst {
    planeKind?:        PlaneKind;
    type:              PurpleType;
    featureId?:        string;
    persistentFaceId?: string;
    selectionEntry?:   string;
    positionMm?:       [number, number, number, ...number[]];
}

export type PurpleType = "principal" | "datum" | "face" | "coordinates";

export interface Plane {
    planeKind?:        PlaneKind;
    type:              BaseType;
    featureId?:        string;
    persistentFaceId?: string;
    selectionEntry?:   string;
}

export interface DefinitionSecond {
    planeKind?:        PlaneKind;
    type:              PurpleType;
    featureId?:        string;
    persistentFaceId?: string;
    selectionEntry?:   string;
    positionMm?:       [number, number, number, ...number[]];
}

export interface Third {
    positionMm?: [number, number, number, ...number[]];
    type:        ThirdType;
    featureId?:  string;
}

export type ThirdType = "coordinates" | "datum";

export interface Through {
    positionMm?: [number, number, number, ...number[]];
    type:        ThirdType;
    featureId?:  string;
}

export type DefinitionType = "principal" | "offset" | "mid" | "angle" | "threePoint" | "twoPoint" | "planeNormal" | "planeIntersection" | "coordinates" | "midpoint";

export type DatumDescriptorKind = "DatumPlane" | "DatumAxis" | "DatumPoint";

export interface DatumGeometry {
    normal?:     [number, number, number, ...number[]];
    originMm?:   [number, number, number, ...number[]];
    xAxis?:      [number, number, number, ...number[]];
    yAxis?:      [number, number, number, ...number[]];
    direction?:  [number, number, number, ...number[]];
    positionMm?: [number, number, number, ...number[]];
}

export type Status = "ok" | "broken" | "error";

export interface FeatureDescriptor {
    dependsOn?:   string[];
    expressions?: { [key: string]: string };
    featureId:    string;
    paramsMm?:    number[];
    refExtra?:    string;
    type:         string;
    volumeMm3?:   number;
    [property: string]: unknown;
}

export interface SketchDescriptor {
    featureId:   string;
    id?:         string;
    model?:      { [key: string]: unknown };
    plane?:      SketchPlaneFrame;
    planeKind?:  string;
    supportRef?: string;
    [property: string]: unknown;
}

export interface SketchPlaneFrame {
    normal: [number, number, number, ...number[]];
    origin: [number, number, number, ...number[]];
    xAxis:  [number, number, number, ...number[]];
    yAxis:  [number, number, number, ...number[]];
}

export interface SessionIncrementalEvent {
    added:           SessionEntityPatch[];
    baseRevision:    number;
    changedMeshIds:  string[];
    documentId:      string;
    event:           SessionIncrementalEventEvent;
    newRevision:     number;
    originClientId:  string;
    referenceRemaps: unknown[];
    removedIds:      string[];
    revision:        number;
    sessionId:       string;
    updated:         SessionEntityPatch[];
    warnings:        unknown[];
}

export interface SessionEntityPatch {
    id:    string;
    index: number;
    kind:  SessionEntityPatchKind;
    value: { [key: string]: unknown };
}

export type SessionEntityPatchKind = "feature" | "sketch" | "body" | "datum";

export type SessionIncrementalEventEvent = "delta";

export interface SessionSnapshotRequiredEvent {
    documentId:     string;
    event:          SessionSnapshotRequiredEventEvent;
    originClientId: string;
    revision:       number;
    sessionId:      string;
    [property: string]: unknown;
}

export type SessionSnapshotRequiredEventEvent = "snapshot-required";

export interface SelectionEvent {
    clientId:    string;
    documentId?: string;
    event:       SelectionEventEvent;
    ids:         string[];
    revision?:   number;
    sessionId?:  string;
    [property: string]: unknown;
}

export type SelectionEventEvent = "selection";

export interface CoreRestartedEvent {
    event:     CoreRestartedEventEvent;
    sessionId: string;
    [property: string]: unknown;
}

export type CoreRestartedEventEvent = "core-restarted";

export interface PairParams {
    deviceName:   string;
    pairingToken: string;
    [property: string]: unknown;
}

export interface AuthenticateParams {
    credential: string;
    deviceId:   string;
    [property: string]: unknown;
}

export interface PairReply {
    credential:   string;
    deviceId:     string;
    sessionToken: string;
    [property: string]: unknown;
}

export interface AuthenticateReply {
    deviceId:     string;
    sessionToken: string;
    [property: string]: unknown;
}

export interface SessionInfoPayload {
    connectedClients: ConnectedClient[];
    documentId:       string;
    documentRevision: number | null;
    sessionId:        string;
    transactionState: null | TransactionState;
    [property: string]: unknown;
}

export interface ConnectedClient {
    capabilities:    string[];
    clientId:        string;
    clientType:      string;
    connectionState: ConnectionState;
    deviceId?:       string;
    name?:           string;
    [property: string]: unknown;
}

export type ConnectionState = "connected" | "closing" | "reconnecting";

export interface TransactionState {
    ownerClientId:  string;
    ownerConnected: boolean;
    state:          State;
    transactionId:  string;
    [property: string]: unknown;
}

export type State = "pending" | "open";

export interface RequestPreviewMeshParams {
    documentId:       string;
    expectedRevision: number;
    generation:       number;
    previewId:        string;
}

export interface PreviewMeshHeader {
    baseRevision:    number;
    bodyId:          string;
    byteLength:      number;
    documentId:      string;
    featureId:       string;
    generation:      number;
    nativeRequestId: string;
    paramName:       string;
    previewId:       string;
    quality:         number;
    sessionId:       string;
    targetTipId:     string;
}

export interface ContextCommandsPayload {
    commands:     ContextCommandInfo[];
    contextValid: boolean;
    documentId:   string;
    revision:     number;
    sessionId:    string;
    [property: string]: unknown;
}

export interface ContextCommandInfo {
    available:       boolean;
    boundParameters: { [key: string]: unknown };
    description:     string;
    id:              string;
    label:           string;
    reason?:         string;
    supportsPreview: boolean;
    [property: string]: unknown;
}

export interface ContextCommandsParams {
    beginnerMode?:    boolean;
    documentId:       string;
    expectedRevision: number;
    selectionIds:     string[];
    [property: string]: unknown;
}

export interface DatumPlaneDescriptor {
    definition: DatumPlaneDefinition;
    dependsOn:  string[];
    error?:     string;
    featureId:  string;
    kind:       DatumPlaneDescriptorKind;
    resolved:   DatumPlaneGeometry;
    status:     Status;
    type?:      DatumPlaneDescriptorKind;
    [property: string]: unknown;
}

export interface DatumPlaneDefinition {
    planeKind?: PlaneKind;
    type:       DatumPlaneDefinitionType;
    base?:      Base;
    offsetMm?:  number;
    first?:     DatumPlaneDefinitionFirst;
    second?:    DatumPlaneDefinitionSecond;
    angleDeg?:  number;
    axis?:      AxisClass;
    third?:     Third;
}

export interface DatumPlaneDefinitionFirst {
    planeKind?:        PlaneKind;
    type:              PurpleType;
    featureId?:        string;
    persistentFaceId?: string;
    selectionEntry?:   string;
    positionMm?:       [number, number, number, ...number[]];
}

export interface DatumPlaneDefinitionSecond {
    planeKind?:        PlaneKind;
    type:              PurpleType;
    featureId?:        string;
    persistentFaceId?: string;
    selectionEntry?:   string;
    positionMm?:       [number, number, number, ...number[]];
}

export type DatumPlaneDefinitionType = "principal" | "offset" | "mid" | "angle" | "threePoint";

export type DatumPlaneDescriptorKind = "DatumPlane";

export interface DatumPlaneGeometry {
    normal:   [number, number, number, ...number[]];
    originMm: [number, number, number, ...number[]];
    xAxis:    [number, number, number, ...number[]];
    yAxis:    [number, number, number, ...number[]];
}

export interface DatumAxisDescriptor {
    definition: DatumAxisDefinition;
    dependsOn:  string[];
    error?:     string;
    featureId:  string;
    kind:       DatumAxisDescriptorKind;
    resolved:   DatumAxisGeometry;
    status:     Status;
    type?:      DatumAxisDescriptorKind;
    [property: string]: unknown;
}

export interface DatumAxisDefinition {
    first?:   DatumAxisDefinitionFirst;
    second?:  DatumAxisDefinitionSecond;
    type:     DatumAxisDefinitionType;
    plane?:   Plane;
    through?: Through;
}

export interface DatumAxisDefinitionFirst {
    positionMm?:       [number, number, number, ...number[]];
    type:              PurpleType;
    featureId?:        string;
    planeKind?:        PlaneKind;
    persistentFaceId?: string;
    selectionEntry?:   string;
}

export interface DatumAxisDefinitionSecond {
    positionMm?:       [number, number, number, ...number[]];
    type:              PurpleType;
    featureId?:        string;
    planeKind?:        PlaneKind;
    persistentFaceId?: string;
    selectionEntry?:   string;
}

export type DatumAxisDefinitionType = "twoPoint" | "planeNormal" | "planeIntersection";

export type DatumAxisDescriptorKind = "DatumAxis";

export interface DatumAxisGeometry {
    direction: [number, number, number, ...number[]];
    originMm:  [number, number, number, ...number[]];
}

export interface DatumPointDescriptor {
    definition: DatumPointDefinition;
    dependsOn:  string[];
    error?:     string;
    featureId:  string;
    kind:       DatumPointDescriptorKind;
    resolved:   DatumPointGeometry;
    status:     Status;
    type?:      DatumPointDescriptorKind;
    [property: string]: unknown;
}

export interface DatumPointDefinition {
    positionMm?: [number, number, number, ...number[]];
    type:        DatumPointDefinitionType;
    first?:      DatumPointDefinitionFirst;
    second?:     DatumPointDefinitionSecond;
}

export interface DatumPointDefinitionFirst {
    positionMm?: [number, number, number, ...number[]];
    type:        ThirdType;
    featureId?:  string;
}

export interface DatumPointDefinitionSecond {
    positionMm?: [number, number, number, ...number[]];
    type:        ThirdType;
    featureId?:  string;
}

export type DatumPointDefinitionType = "coordinates" | "midpoint";

export type DatumPointDescriptorKind = "DatumPoint";

export interface DatumPointGeometry {
    positionMm: [number, number, number, ...number[]];
}

