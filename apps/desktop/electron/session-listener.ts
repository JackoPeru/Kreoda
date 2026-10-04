import { networkInterfaces } from "node:os";
import { isIP } from "node:net";

type InterfaceMap = Record<string, readonly { address: string; family: string | number; internal: boolean }[] | undefined>;
function privateIpv4(address: string): boolean {
  if (isIP(address) !== 4) return false;
  const [a, b] = address.split(".").map(Number);
  return a === 10 || (a === 172 && b! >= 16 && b! <= 31) || (a === 192 && b === 168);
}
export function sessionInterfaces(interfaces: InterfaceMap = networkInterfaces()): { name: string; address: string; localOnly: boolean }[] {
  const found = [{ name: "Local", address: "127.0.0.1", localOnly: true }];
  for (const [name, addresses] of Object.entries(interfaces)) {
    for (const value of addresses ?? []) {
      if (!value.internal && (value.family === "IPv4" || value.family === 4) && privateIpv4(value.address) && !found.some(item => item.address === value.address)) {
        found.push({ name, address: value.address, localOnly: false });
      }
    }
  }
  return found;
}
export function validateSessionListener(value: { host: string; port: number }, interfaces: InterfaceMap = networkInterfaces()): { host: string; port: number } {
  if (!Number.isInteger(value.port) || value.port < 0 || value.port > 65535) throw Object.assign(new Error("port must be an integer from 0 to 65535"), { code: "BAD_PARAMS" });
  if (value.host !== "127.0.0.1" && !sessionInterfaces(interfaces).some(item => item.address === value.host)) {
    throw Object.assign(new Error("select an assigned private IPv4 interface or loopback"), { code: "BAD_PARAMS" });
  }
  return { host: value.host, port: value.port };
}
