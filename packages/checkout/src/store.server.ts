/**
 * The `@continuity/checkout/store` entry: the checkout store, for server code
 * only. Its state lives in one process, so a client bundle that reaches it is
 * a mistake, and `server-only` turns that into a build error.
 *
 * Unit tests import `./store` directly, going around this guard on purpose;
 * package consumers can't, since only this file is exported.
 */
import "server-only";

export * from "./store";
