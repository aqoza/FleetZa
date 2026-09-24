import { Hono } from "hono";
import type { AppEnv } from "./lib";

/**
 * /api/track/:token — PUBLIC delivery tracking (capability link).
 * Owned by the `logistics_delivery` module. Placeholder; replaced by the module build.
 */
export const tracking = new Hono<AppEnv>();
