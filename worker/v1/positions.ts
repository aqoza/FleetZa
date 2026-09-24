import { Hono } from "hono";
import type { ApiEnv } from "../apiKey";

/**
 * POST /api/v1/positions — batch GPS fixes (scope telematics:write).
 * Owned by the `gps_tracking` module. Placeholder; replaced by the module build.
 */
export const positionsApi = new Hono<ApiEnv>();
