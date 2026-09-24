import { Hono } from "hono";
import type { AppEnv } from "./lib";

/**
 * /api/integrations/* — webhook delivery dispatch (member JWT).
 * Owned by the `integrations` module. Placeholder; replaced by the module build.
 */
export const integrations = new Hono<AppEnv>();
