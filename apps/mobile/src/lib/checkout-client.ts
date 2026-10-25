import { createCheckoutClient } from "@continuity/checkout";

/**
 * The web app's origin. `localhost` means the phone itself, so on a device
 * or Expo Go set EXPO_PUBLIC_API_URL to your computer's LAN address, e.g.
 * `EXPO_PUBLIC_API_URL=http://192.168.1.20:3000 pnpm dev:mobile`. (The
 * Android emulator reaches the host at http://10.0.2.2:3000.)
 */
export const API_URL =
  process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3000";

/** The same client the web island uses: same parsing, same clock anchoring. */
export const checkoutClient = createCheckoutClient({ baseUrl: API_URL });
