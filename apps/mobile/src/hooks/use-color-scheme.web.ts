/**
 * Always dark on web. The server render can't know the browser's preference,
 * so following it causes a hydration mismatch. Web is only for automated
 * tests, so a fixed theme is fine.
 */
export function useColorScheme() {
  return "dark" as const;
}
