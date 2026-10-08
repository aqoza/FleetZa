import { Hono } from "hono";
import type { AppEnv } from "./lib";

/**
 * /api/security/* — reserved for the `audit_security` module.
 *
 * Member access review and session revocation are SQL RPCs instead
 * (public.security_members, public.revoke_member_sessions in
 * 20261008000008_audit_security.sql): both only need auth.users /
 * auth.sessions, which a SECURITY DEFINER function reads directly under the
 * tenant and admin checks, so no service-role round trip is needed. The
 * route stays mounted for future server-side security work.
 */
export const security = new Hono<AppEnv>();
