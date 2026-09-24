import { Hono } from "hono";
import type { ApiEnv } from "../apiKey";

/**
 * POST /api/v1/driving-events — safety events (scope driver_events:write).
 * Owned by the `driver_behavior` module. Placeholder; replaced by the module build.
 */
export const drivingEventsApi = new Hono<ApiEnv>();
