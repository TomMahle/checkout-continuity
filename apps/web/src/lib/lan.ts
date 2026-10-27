import "server-only";
import { networkInterfaces } from "node:os";

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** 10/8, 172.16/12 and 192.168/16: a home or office network, not a VPN. */
function isPrivate(address: string) {
  const [a, b] = address.split(".").map(Number);
  return (
    a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
  );
}

/** This computer's IPv4 address on the local network, if it has one. */
export function lanAddress(): string | undefined {
  const addresses = Object.values(networkInterfaces())
    .flat()
    .filter((a) => a?.family === "IPv4" && !a.internal);
  return (addresses.find((a) => isPrivate(a!.address)) ?? addresses[0])
    ?.address;
}

/**
 * The origin to put in links for other devices. A page opened at localhost
 * would hand a phone a link back to the phone itself, so swap a loopback
 * host for this computer's network address (keeping the port).
 */
export function shareableOrigin(origin: string): string {
  const url = new URL(origin);
  const lan = LOOPBACK.has(url.hostname) ? lanAddress() : undefined;
  if (lan) url.hostname = lan;
  return url.origin;
}
