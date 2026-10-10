import { create } from "zustand";
import { SelectionEventSchema, type CoreMeshData } from "@kreoda/protocol";
import type { SessionSelection } from "../../electron/session";

export interface TargetContext { sessionId: string; documentId: string; revision: number }
interface SharedTargets {
  context: TargetContext | null;
  events: SessionSelection[];
  receive: (event: unknown) => void;
  setContext: (context: TargetContext) => void;
  reset: () => void;
}
export const useSharedTargetStore = create<SharedTargets>((set) => ({
  context: null, events: [],
  receive: (raw) => {
    const parsed = SelectionEventSchema.safeParse(raw);
    if (!parsed.success) return;
    const event = parsed.data;
    if (!event.sessionId || !event.documentId || event.revision === undefined ||
        event.ids.length > 256 || event.ids.some(id => id.length > 4096) || event.clientId.length > 128) return;
    const stamped: SessionSelection = { event: "selection", clientId: event.clientId, ids: [...event.ids],
      sessionId: event.sessionId, documentId: event.documentId, revision: event.revision };
    set(state => {
      const context = state.context;
      if (context && stamped.sessionId === context.sessionId && stamped.documentId === context.documentId &&
          stamped.revision < context.revision) return state;
      const events = state.events.filter(previous => previous.clientId !== stamped.clientId ||
        (stamped.ids.length === 0 && (previous.sessionId !== stamped.sessionId || previous.documentId !== stamped.documentId)));
      if (stamped.ids.length > 0) events.push(stamped);
      // Bounded metadata even before the first authoritative snapshot arrives.
      return { events: events.slice(-32) };
    });
  },
  setContext: (context) => set(state => ({ context: { ...context }, events: state.events.filter(event =>
    event.sessionId === context.sessionId && event.documentId === context.documentId && event.revision >= context.revision) })),
  reset: () => set({ context: null, events: [] }),
}));
export function currentSharedTargets(): SessionSelection[] {
  const { context, events } = useSharedTargetStore.getState();
  return context ? events.filter(event => event.sessionId === context.sessionId && event.documentId === context.documentId &&
    event.revision === context.revision) : [];
}

export function visibleSharedTargets(meshes: Record<string, CoreMeshData>, view?: Pick<TargetContext, "documentId" | "revision">): SessionSelection[] {
  const context = useSharedTargetStore.getState().context;
  if (view && (!context || context.documentId !== view.documentId || context.revision !== view.revision)) return [];
  const counts = new Map<string, number>();
  for (const [owner, mesh] of Object.entries(meshes)) {
    counts.set(owner, (counts.get(owner) ?? 0) + 1);
    for (const id of [...mesh.faces.map(face => face.persistentFaceId), ...mesh.edges.map(edge => edge.persistentEdgeId)])
      counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return currentSharedTargets().map(event => ({ ...event, ids: event.ids.filter(id => counts.get(id) === 1) }))
    .filter(event => event.ids.length > 0);
}
