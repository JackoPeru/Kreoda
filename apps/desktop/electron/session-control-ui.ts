import type { TrustedSessionDevice } from "./session-devices";

export interface SessionConnectionStatus {
  listener: { host: string; port: number } | null;
  interfaces: { name: string; host: string }[];
  devices: TrustedSessionDevice[];
  clients: { deviceId?: string; name: string; clientType: string; capabilities: string[] }[];
  transaction: { ownerClientId: string; transactionId: string } | null;
  pairingAvailable: boolean;
}
