import { Hono } from "hono";
import type { AppEnv } from "./lib";

/**
 * /api/portal/:token — PUBLIC customer portal (capability link).
 * Owned by the `customer_portal` module. Placeholder; replaced by the module build.
 */
export const customerPortal = new Hono<AppEnv>();
