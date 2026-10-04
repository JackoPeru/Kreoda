import type { TrustedSessionDevice } from "./session-devices";
import type { SessionInfoPayload } from "@kreoda/protocol";

export interface SessionConnectionStatus {
  session: SessionInfoPayload;
  listener: { host: string; port: number } | null;
  interfaces: { name: string; host: string }[];
  devices: TrustedSessionDevice[];
  clients: { deviceId?: string; name: string; clientType: string; capabilities: string[] }[];
  transaction: { ownerClientId: string; transactionId: string } | null;
  pairingAvailable: boolean;
}
