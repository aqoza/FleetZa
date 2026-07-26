import { Hono } from "hono";
import { z } from "zod";
import { adminClient, type AppEnv } from "./lib";

export const quotes = new Hono<AppEnv>();

/**
 * PUBLIC quote review + acceptance. The link a salesperson sends the customer
 * (`/q/:token`) resolves here. Same posture as the certificate verify
 * endpoint: looked up by an unguessable uuid, no auth, service role scoped to
 * exactly the rows behind that token, and only whitelisted fields come back.
 *
 * Drafts and canceled quotes are deliberately indistinguishable from a bad
 * token — a customer must never see a quote that was never sent to them.
 */

const VISIBLE_STATUSES = ["sent", "accepted", "declined", "expired"];

/** The worker's Supabase client is untyped, so the selected shapes are declared
 *  here (same approach verify.ts takes for its embedded rows). */
interface QuoteRow {
  id: string;
  doc_number: string;
  status: string;
  issue_date: string;
  valid_until: string | null;
  currency: string;
  subtotal: number;
  discount_total: number;
  tax_total: number;
  total: number;
  title: string | null;
  customer_reference: string | null;
  terms: string | null;
  notes: string | null;
  accepted_at: string | null;
  accepted_by_name: string | null;
  tenant_id: string;
  customer_id: string;
}

interface QuoteLineRow {
  id: string;
  description: string;
  quantity: number;
  unit: string | null;
  unit_price: number;
  discount_percent: number;
  line_total: number;
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

async function loadQuote(env: AppEnv["Bindings"], token: string) {
  const admin = adminClient(env);
  const { data } = await admin
    .from("quotes")
    .select(
      "id, doc_number, status, issue_date, valid_until, currency, subtotal, " +
        "discount_total, tax_total, total, title, customer_reference, terms, notes, " +
        "accepted_at, accepted_by_name, tenant_id, customer_id",
    )
    .eq("public_token", token)
    .maybeSingle();
  return { admin, quote: (data as unknown as QuoteRow | null) ?? null };
}

quotes.get("/:token", async (c) => {
  const token = c.req.param("token");
  if (!z.string().uuid().safeParse(token).success) {
    return c.json({ status: "not_found" }, 404);
  }

  const { admin, quote } = await loadQuote(c.env, token);
  if (!quote || !VISIBLE_STATUSES.includes(quote.status)) {
    return c.json({ status: "not_found" }, 404);
  }

  const [linesRes, tenantRes, customerRes] = await Promise.all([
    admin
      .from("quote_lines")
      .select("id, description, quantity, unit, unit_price, discount_percent, line_total")
      .eq("quote_id", quote.id)
      .order("sort_order")
      .order("created_at"),
    admin
      .from("tenants")
      .select("name, address, phone")
      .eq("id", quote.tenant_id)
      .maybeSingle(),
    admin.from("customers").select("name").eq("id", quote.customer_id).maybeSingle(),
  ]);
  const lines = (linesRes.data as unknown as QuoteLineRow[] | null) ?? [];
  const tenant = tenantRes.data as unknown as
    | { name: string; address: string | null; phone: string | null }
    | null;
  const customer = customerRes.data as unknown as { name: string } | null;

  // A quote past its validity reads as expired to the customer even though no
  // scheduler has flipped the stored status (docs/ARCHITECTURE_REVIEW.md §5-G).
  const expired =
    quote.status === "sent" && quote.valid_until !== null && quote.valid_until < todayISO();

  return c.json({
    status: expired ? "expired" : quote.status,
    canAccept: quote.status === "sent" && !expired,
    docNumber: quote.doc_number,
    issueDate: quote.issue_date,
    validUntil: quote.valid_until,
    currency: quote.currency,
    subtotal: quote.subtotal,
    discountTotal: quote.discount_total,
    taxTotal: quote.tax_total,
    total: quote.total,
    title: quote.title,
    customerReference: quote.customer_reference,
    terms: quote.terms,
    notes: quote.notes,
    acceptedAt: quote.accepted_at,
    acceptedByName: quote.accepted_by_name,
    companyName: tenant?.name ?? null,
    companyAddress: tenant?.address ?? null,
    companyPhone: tenant?.phone ?? null,
    customerName: customer?.name ?? null,
    lines,
  });
});

const acceptSchema = z.object({ name: z.string().trim().min(1).max(120) });

quotes.post("/:token/accept", async (c) => {
  const token = c.req.param("token");
  if (!z.string().uuid().safeParse(token).success) {
    return c.json({ error: "Not found" }, 404);
  }

  const body = acceptSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "A name is required" }, 400);

  const { admin, quote } = await loadQuote(c.env, token);
  if (!quote) return c.json({ error: "Not found" }, 404);

  // Acceptance is only legal from `sent`, and only while the quote is valid —
  // re-checked here rather than trusted from the page that called us.
  if (quote.status !== "sent") return c.json({ error: "Not available" }, 409);
  if (quote.valid_until !== null && quote.valid_until < todayISO()) {
    return c.json({ error: "Expired" }, 409);
  }

  const { error } = await admin
    .from("quotes")
    .update({
      status: "accepted",
      accepted_by_name: body.data.name,
      accepted_at: new Date().toISOString(),
    })
    .eq("id", quote.id)
    // Re-assert the status in the predicate so two simultaneous clicks can't
    // both "win" — the second matches no rows.
    .eq("status", "sent");
  if (error) {
    console.error("[quotes.accept]", error.message);
    return c.json({ error: "Could not record acceptance" }, 500);
  }

  return c.json({ ok: true });
});
