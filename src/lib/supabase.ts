import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!url || !anonKey) {
  if (import.meta.env.PROD) {
    // A production build without Supabase config is broken on every screen —
    // fail loudly at startup instead of rendering a dead app.
    throw new Error("Supabase configuration missing: VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY");
  }
  // Surfaced early so a missing .env is obvious in development.
  console.error("Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY — copy .env.example to .env");
}

export const supabase = createClient<Database>(url ?? "http://localhost:54321", anonKey ?? "anon", {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
