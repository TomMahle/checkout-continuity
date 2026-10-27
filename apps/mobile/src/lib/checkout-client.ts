import { createCheckoutClient } from "@continuity/checkout";
import Constants from "expo-constants";
import { fetch as expoFetch } from "expo/fetch";

/**
 * Metro's host, as this device reaches it (e.g. `192.168.1.20`). In
 * development that's the computer running the web server too.
 */
const devHost = Constants.expoConfig?.hostUri?.split(":")[0];

/**
 * The web app's origin. `localhost` would mean the phone itself, so default
 * to the dev computer's network address on the web server's port; set
 * EXPO_PUBLIC_API_URL to point somewhere else.
 */
export const API_URL =
  process.env.EXPO_PUBLIC_API_URL ??
  (devHost ? `http://${devHost}:3000` : "http://localhost:3000");

/**
 * The same client the web island uses: same parsing, same clock anchoring.
 * React Native's own fetch can't stream a response body, so server-sent
 * events go through `expo/fetch`, which can.
 */
export const checkoutClient = createCheckoutClient({
  baseUrl: API_URL,
  streamFetch: expoFetch as typeof fetch,
});
