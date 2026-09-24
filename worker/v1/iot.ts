import { Hono } from "hono";
import type { ApiEnv } from "../apiKey";

/**
 * POST /api/v1/iot/readings — sensor readings (scope iot:write).
 * Owned by the `iot_devices` module. Placeholder; replaced by the module build.
 */
export const iotApi = new Hono<ApiEnv>();
