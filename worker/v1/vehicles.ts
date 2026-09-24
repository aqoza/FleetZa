import { Hono } from "hono";
import type { ApiEnv } from "../apiKey";

/**
 * GET /api/v1/vehicles — the key's tenant's vehicles (scope vehicles:read).
 * Owned by the `gps_tracking` module. Placeholder; replaced by the module build.
 */
export const vehiclesApi = new Hono<ApiEnv>();
