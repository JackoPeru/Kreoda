export type SessionEntityKind = "feature" | "sketch" | "body";
export type SessionModelEntity = Record<string, unknown>;

export interface SessionModelSnapshot {
  sessionId: string;
  documentId: string;
  revision: number;
  features: SessionModelEntity[];
  sketches: SessionModelEntity[];
  bodies: SessionModelEntity[];
}

export interface SessionEntityChange {
  kind: SessionEntityKind;
  id: string;
  index: number;
  value: SessionModelEntity;
}

export interface SessionIncrementalDelta {
  event: "delta";
  baseRevision: number;
  newRevision: number;
  revision: number;
  sessionId: string;
  documentId: string;
  originClientId: string;
  added: SessionEntityChange[];
  updated: SessionEntityChange[];
  removedIds: string[];
  changedMeshIds: string[];
  referenceRemaps: unknown[];
  warnings: unknown[];
}

export type SessionDeltaDecision =
  | {
      status: "applied";
      model: SessionModelSnapshot;
      referenceRemaps: unknown[];
      warnings: unknown[];
    }
  | { status: "duplicate"; model: SessionModelSnapshot }
  | {
      status: "needs-snapshot";
      reason: "gap" | "lineage" | "malformed";
      model: SessionModelSnapshot;
    };

const KINDS: readonly SessionEntityKind[] = ["feature", "sketch", "body"];
const COLLECTIONS: Record<SessionEntityKind, keyof Pick<
  SessionModelSnapshot,
  "features" | "sketches" | "bodies"
>> = {
  feature: "features",
  sketch: "sketches",
  body: "bodies",
};

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function entityId(kind: SessionEntityKind, value: unknown): string | null {
  if (!record(value)) return null;
  const key = kind === "body" ? "bodyId" : "featureId";
  const id = value[key];
  return typeof id === "string" && id.length > 0 ? id : null;
}

function validRevision(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function malformed(model: SessionModelSnapshot): SessionDeltaDecision {
  return { status: "needs-snapshot", reason: "malformed", model };
}

function validModel(model: SessionModelSnapshot): boolean {
  if (
    !record(model) ||
    typeof model.sessionId !== "string" || model.sessionId.length === 0 ||
    typeof model.documentId !== "string" || model.documentId.length === 0 ||
    !validRevision(model.revision)
  ) return false;
  for (const kind of KINDS) {
    const collection = model[COLLECTIONS[kind]];
    if (!Array.isArray(collection)) return false;
    const ids = new Set<string>();
    for (const value of collection) {
      const id = entityId(kind, value);
      if (id === null || ids.has(id)) return false;
      ids.add(id);
    }
  }
  return true;
}

function parseChanges(value: unknown): SessionEntityChange[] | null {
  if (!Array.isArray(value)) return null;
  const changes: SessionEntityChange[] = [];
  for (const raw of value) {
    if (!record(raw)) return null;
    const kind = raw["kind"];
    const id = raw["id"];
    const index = raw["index"];
    const entity = raw["value"];
    if (
      typeof kind !== "string" || !KINDS.includes(kind as SessionEntityKind) ||
      typeof id !== "string" || id.length === 0 ||
      !Number.isSafeInteger(index) || (index as number) < 0 ||
      !record(entity) || entityId(kind as SessionEntityKind, entity) !== id
    ) return null;
    changes.push({ kind: kind as SessionEntityKind, id, index: index as number, value: entity });
  }
  return changes;
}

function applyCollection(
  kind: SessionEntityKind,
  before: SessionModelEntity[],
  removedIds: Set<string>,
  added: SessionEntityChange[],
  updated: SessionEntityChange[],
): SessionModelEntity[] | null {
  const add = added.filter((change) => change.kind === kind);
  const update = updated.filter((change) => change.kind === kind);
  const priorIds = new Set(before.map((value) => entityId(kind, value)!));
  const changedIds = new Set<string>();
  const indices = new Set<number>();
  const slots: (SessionModelEntity | undefined)[] = [];

  for (const change of add) {
    if (priorIds.has(change.id) || removedIds.has(change.id)) return null;
    if (changedIds.has(change.id)) return null;
    changedIds.add(change.id);
  }
  for (const change of update) {
    if (!priorIds.has(change.id) || removedIds.has(change.id)) return null;
    if (changedIds.has(change.id)) return null;
    changedIds.add(change.id);
  }

  const kept = before.filter((value) => !removedIds.has(entityId(kind, value)!));
  const length = kept.length + add.length;
  slots.length = length;
  for (const change of [...add, ...update]) {
    if (change.index >= length || indices.has(change.index)) return null;
    indices.add(change.index);
    slots[change.index] = change.value;
  }

  const unchanged = kept.filter((value) => !changedIds.has(entityId(kind, value)!));
  let cursor = 0;
  for (const value of unchanged) {
    while (cursor < length && slots[cursor] !== undefined) cursor += 1;
    if (cursor >= length) return null;
    slots[cursor] = value;
    cursor += 1;
  }
  if (slots.some((value) => value === undefined)) return null;
  return slots as SessionModelEntity[];
}

/** Apply one authoritative JSON delta, or report why a full snapshot is needed. */
export function applySessionModelDelta(
  model: SessionModelSnapshot,
  rawDelta: unknown,
): SessionDeltaDecision {
  if (!validModel(model) || !record(rawDelta)) return malformed(model);
  const delta = rawDelta;
  if (
    delta["event"] !== "delta" ||
    !validRevision(delta["baseRevision"]) ||
    !validRevision(delta["newRevision"]) ||
    !validRevision(delta["revision"]) ||
    delta["revision"] !== delta["newRevision"] ||
    delta["newRevision"] <= delta["baseRevision"] ||
    typeof delta["sessionId"] !== "string" || delta["sessionId"].length === 0 ||
    typeof delta["documentId"] !== "string" || delta["documentId"].length === 0 ||
    typeof delta["originClientId"] !== "string" || delta["originClientId"].length === 0 ||
    !Array.isArray(delta["removedIds"]) ||
    !Array.isArray(delta["changedMeshIds"]) ||
    !Array.isArray(delta["referenceRemaps"]) ||
    !Array.isArray(delta["warnings"]) ||
    ["features", "sketches", "bodies", "tips"].some((key) => Object.hasOwn(delta, key))
  ) return malformed(model);

  const added = parseChanges(delta["added"]);
  const updated = parseChanges(delta["updated"]);
  const removedIds = delta["removedIds"];
  const changedMeshIds = delta["changedMeshIds"];
  if (
    !added || !updated ||
    !removedIds.every((id) => typeof id === "string" && id.length > 0) ||
    new Set(removedIds).size !== removedIds.length ||
    !changedMeshIds.every((id) => typeof id === "string" && id.length > 0)
  ) return malformed(model);
  const removed = new Set(removedIds as string[]);
  const changedIdentities = new Set<string>();
  for (const change of [...added, ...updated]) {
    const identity = `${change.kind}\0${change.id}`;
    if (changedIdentities.has(identity) || removed.has(change.id)) return malformed(model);
    changedIdentities.add(identity);
  }

  if (delta["sessionId"] !== model.sessionId || delta["documentId"] !== model.documentId) {
    return { status: "needs-snapshot", reason: "lineage", model };
  }
  if ((delta["newRevision"] as number) <= model.revision) {
    return { status: "duplicate", model };
  }
  if (delta["baseRevision"] !== model.revision) {
    return { status: "needs-snapshot", reason: "gap", model };
  }

  const features = applyCollection("feature", model.features, removed, added, updated);
  const sketches = applyCollection("sketch", model.sketches, removed, added, updated);
  const bodies = applyCollection("body", model.bodies, removed, added, updated);
  if (!features || !sketches || !bodies) return malformed(model);

  return {
    status: "applied",
    model: {
      sessionId: model.sessionId,
      documentId: model.documentId,
      revision: delta["newRevision"] as number,
      features,
      sketches,
      bodies,
    },
    referenceRemaps: delta["referenceRemaps"],
    warnings: delta["warnings"],
  };
}
