/**
 * The `@continuity/checkout/react` entry: React bindings, shared by the web
 * and mobile apps. Kept apart so the main entry stays free of React. React is
 * a peer dependency, pinned for every package by the pnpm catalog, so the
 * apps and this code always resolve the same copy.
 */
export * from "./use-checkout-session";
