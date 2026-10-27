import "server-only";
import { lanAddress } from "../../lan-address";

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

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
