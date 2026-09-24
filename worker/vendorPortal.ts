import { Hono } from "hono";
import type { AppEnv } from "./lib";

/**
 * /api/vendor-portal/:token — PUBLIC vendor portal (capability link).
 * Owned by the `vendor_portal` module. Placeholder; replaced by the module build.
 */
export const vendorPortal = new Hono<AppEnv>();
