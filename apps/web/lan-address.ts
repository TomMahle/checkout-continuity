import { networkInterfaces } from "node:os";

/*
 * Shared by next.config.ts and src/lib/lan.ts. No `server-only` here: the
 * config isn't loaded under the react-server condition.
 */

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
