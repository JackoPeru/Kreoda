// Generated from schemas/session-control-v1.json. Do not edit.
// Source SHA256: 41ed0a01287a297f3a6d52e40efb0ffa06270bb9d8debe0fe3f7c0d1a28a4ddb
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
    protocolVersion: number;
    token:           string;
    [property: string]: unknown;
}

export interface SnapshotParams {
    documentId?: string;
    [property: string]: unknown;
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
    documentId:   string;
    ok:           boolean;
    requestId:    string;
    revision:     number;
    sessionId:    string;
    [property: string]: unknown;
}

export interface SessionSnapshotPayload {
    bodies:     BodyDescriptor[];
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
    plane?:      { [key: string]: unknown };
    planeKind?:  string;
    supportRef?: string;
    [property: string]: unknown;
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
    kind:  Kind;
    value: { [key: string]: unknown };
}

export type Kind = "feature" | "sketch" | "body";

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
    clientId: string;
    event:    SelectionEventEvent;
    ids:      string[];
    [property: string]: unknown;
}

export type SelectionEventEvent = "selection";

export interface CoreRestartedEvent {
    event:     CoreRestartedEventEvent;
    sessionId: string;
    [property: string]: unknown;
}

export type CoreRestartedEventEvent = "core-restarted";

