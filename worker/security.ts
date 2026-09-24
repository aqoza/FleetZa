import { Hono } from "hono";
import type { AppEnv } from "./lib";

/**
 * /api/security/* — member access review + session revocation (admin JWT).
 * Owned by the `audit_security` module. Placeholder; replaced by the module build.
 */
export const security = new Hono<AppEnv>();
