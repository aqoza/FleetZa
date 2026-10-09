// Finance smoke fixture: the seeded chart of accounts (plus a child account
// and an inactive one), the default mapping, posted invoice / payment /
// expense / payroll entries, a manual draft, a reversed entry with its
// reversal, and expenses in every status. The report RPCs are computed from
// the same lines, so the trial balance and balance sheet balance.
const T = "170d2d86-5c22-4bcb-9d74-420c879419b2";
const ME = "129bbbae-fdfc-4d21-8a86-8949fec2403b";
const CUST_1 = "c1a0e5f2-3b4d-4e6f-8a9b-0c1d2e3f4a51";
const V1 = "5eed0000-0000-4000-8000-00000000e001";
const day = (n) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const ts = (n) => new Date(Date.now() + n * 86_400_000).toISOString();
const aid = (code) => `18100000-0000-4000-8000-${String(code).padStart(12, "0")}`;
const eid = (n) => `18200000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const lid = (n) => `18300000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const xid = (n) => `18400000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const actor = { created_by: ME, updated_by: ME, created_at: ts(-90), updated_at: ts(-1) };

const chart = [
  ["1000", "Cash", "النقدية", "asset", true], ["1010", "Bank", "البنك", "asset", true],
  ["1100", "Accounts receivable", "الذمم المدينة", "asset", true], ["1200", "Inventory", "المخزون", "asset", true],
  ["1300", "VAT input", "ضريبة المدخلات", "asset", true], ["1500", "Vehicles and equipment", "المركبات والمعدات", "asset", false],
  ["2000", "Accounts payable", "الذمم الدائنة", "liability", true], ["2100", "VAT output", "ضريبة المخرجات", "liability", true],
  ["2200", "Payroll liabilities", "التزامات الرواتب", "liability", true], ["3000", "Owner's equity", "حقوق الملكية", "equity", true],
  ["3100", "Retained earnings", "الأرباح المحتجزة", "equity", true], ["4000", "Sales revenue", "إيرادات المبيعات", "income", true],
  ["4100", "Service revenue", "إيرادات الخدمات", "income", false], ["5050", "Purchases", "المشتريات", "expense", true],
  ["6000", "Fuel expense", "مصروف الوقود", "expense", false], ["6010", "Diesel", "ديزل", "expense", false],
  ["6100", "Maintenance expense", "مصروف الصيانة", "expense", false], ["6300", "Salaries expense", "مصروف الرواتب", "expense", true],
  ["6500", "Rent", "الإيجار", "expense", false], ["6900", "Other expense", "مصروفات أخرى", "expense", false],
  ["6950", "Old leasing cost", null, "expense", false],
];
const gl_accounts = chart.map(([code, name, name_ar, account_type, is_system]) => ({
  id: aid(code), tenant_id: T, code, name, name_ar, account_type, is_system, description: null,
  parent_id: code === "6010" ? aid("6000") : null, active: code !== "6950", ...actor,
}));
const keys = { cash: "1000", bank: "1010", receivable: "1100", inventory: "1200", vat_input: "1300", payable: "2000", vat_output: "2100",
  payroll_liabilities: "2200", equity: "3000", retained_earnings: "3100", revenue: "4000", purchases: "5050", salaries: "6300" };
const finance_settings = [{
  id: "18000000-0000-4000-8000-000000000001", tenant_id: T, fiscal_year_start_month: 1, lock_date: day(-60), updated_by: ME,
  updated_at: ts(-5), accounts: Object.fromEntries(Object.entries(keys).map(([k, c]) => [k, aid(c)])),
}];

let ln = 0;
const journal_lines = [];
const journal_entries = [];
const entry = (n, date, memo, source_type, status, lines, extra = {}) => {
  const total = lines.reduce((s, l) => s + (l[1] ?? 0), 0);
  journal_entries.push({
    id: eid(n), tenant_id: T, number: n, doc_number: `JE-${String(n).padStart(5, "0")}`, entry_date: date, memo, status, source_type,
    source_id: source_type === "manual" ? null : xid(900 + n), reversal_of: null, reversed_by: null, total,
    posted_at: status === "draft" ? null : ts(-1), posted_by: status === "draft" ? null : ME, ...actor, ...extra,
  });
  lines.forEach(([code, debit, credit, description], i) => journal_lines.push({
    id: lid(++ln), tenant_id: T, entry_id: eid(n), account_id: aid(code), sort_order: i + 1, description: description ?? null,
    debit: debit ?? 0, credit: credit ?? 0, vehicle_id: null, customer_id: null, supplier_id: null, ...actor,
  }));
};
entry(1, day(-150), "Opening balance", "manual", "posted", [["1010", 50000], ["3000", 0, 50000]]);
entry(2, day(-120), "Invoice INV-00031", "invoice", "posted", [["1100", 11500], ["4000", 0, 10000], ["2100", 0, 1500, "VAT"]]);
entry(3, day(-100), "Payment for INV-00031", "payment", "posted", [["1010", 11500], ["1100", 0, 11500]]);
entry(4, day(-80), "Invoice INV-00036", "invoice", "posted", [["1100", 8050], ["4000", 0, 7000], ["2100", 0, 1050, "VAT"]]);
entry(5, day(-60), "Payroll PAY-00004", "payroll", "posted", [["6300", 9200], ["1010", 0, 8000], ["2200", 0, 1200]]);
entry(6, day(-40), "EXP-00003 Diesel fill, Truck 07", "expense", "posted", [["6010", 400], ["1300", 20, 0, "VAT"], ["1000", 0, 420]]);
entry(7, day(-30), "Invoice INV-00040", "invoice", "reversed", [["1100", 2300], ["4000", 0, 2000], ["2100", 0, 300, "VAT"]],
  { reversed_by: eid(8) });
entry(8, day(-25), "Source voided or deleted", "invoice", "posted", [["1100", 0, 2300], ["4000", 2000], ["2100", 300, 0, "VAT"]],
  { reversal_of: eid(7), source_id: xid(907) });
entry(9, day(-10), "Invoice INV-00044", "invoice", "posted", [["1100", 5750], ["4100", 0, 5000], ["2100", 0, 750, "VAT"]]);
entry(10, day(-5), "Rent, October", "manual", "posted", [["6500", 3000], ["1010", 0, 3000]]);
entry(11, day(-1), "Cash top-up for petty cash", "manual", "draft", [["1000", 500], ["1010", 0, 300]]);

const sup = { name: "Al Noor Fuel Station" };
const exp = (n, o) => ({
  id: xid(n), tenant_id: T, number: n, doc_number: `EXP-${String(n).padStart(5, "0")}`, expense_date: day(-n * 3), category_account_id: aid("6010"),
  payment_account_id: aid("1000"), supplier_id: null, vehicle_id: null, description: "Expense", reference: null, amount: 100, tax_amount: 5,
  total: 105, status: "draft", rejection_reason: null, receipt_document_id: null, journal_entry_id: null, approved_at: null, approved_by: null,
  supplier: null, vehicle: null, ...actor, ...o,
});
const expenses = [
  exp(1, { description: "Tyre repair, Van 12", category_account_id: aid("6100"), amount: 180, tax_amount: 9, total: 189, reference: "RCPT-5512" }),
  exp(2, { description: "Diesel fill, Truck 07", amount: 400, tax_amount: 20, total: 420, status: "approved", approved_at: ts(-2),
    supplier_id: "18500000-0000-4000-8000-000000000001", supplier: sup, vehicle_id: V1, vehicle: { name: "Truck 07", license_plate: "1234 AB" } }),
  exp(3, { description: "Diesel fill, Truck 07", amount: 400, tax_amount: 20, total: 420, status: "posted", journal_entry_id: eid(6),
    supplier: sup, vehicle: { name: "Truck 07", license_plate: "1234 AB" } }),
  exp(4, { description: "تذاكر مواقف المطار", category_account_id: aid("6900"), amount: 35, tax_amount: 0, total: 35, status: "rejected",
    rejection_reason: "Personal parking, not a company expense." }),
];

const live = () => journal_entries.filter((e) => e.status !== "draft");
const balances = (from, to) => {
  const out = new Map();
  for (const e of live()) {
    if (to && e.entry_date > to) continue;
    for (const l of journal_lines.filter((x) => x.entry_id === e.id)) {
      const r = out.get(l.account_id) ?? { account_id: l.account_id, opening: 0, debit: 0, credit: 0 };
      if (from && e.entry_date < from) r.opening += l.debit - l.credit;
      else { r.debit += l.debit; r.credit += l.credit; }
      out.set(l.account_id, r);
    }
  }
  return [...out.values()];
};
const typeOf = (id) => gl_accounts.find((a) => a.id === id)?.account_type;

export default {
  tables: { gl_accounts, finance_settings, journal_entries, journal_lines, expenses },
  rpc: {
    finance_balances: (a) => balances(a.p_from ?? null, a.p_to ?? null),
    finance_monthly: (a) => {
      const m = new Map();
      for (const e of live()) {
        if (e.entry_date < a.p_from || e.entry_date > a.p_to) continue;
        for (const l of journal_lines.filter((x) => x.entry_id === e.id)) {
          const type = typeOf(l.account_id);
          if (type !== "income" && type !== "expense") continue;
          const k = `${e.entry_date.slice(0, 7)}|${type}`;
          m.set(k, (m.get(k) ?? 0) + (type === "income" ? l.credit - l.debit : l.debit - l.credit));
        }
      }
      return [...m.entries()].map(([k, amount]) => ({ month: k.split("|")[0], account_type: k.split("|")[1], amount }));
    },
    finance_ledger: (a) => {
      let bal = 0;
      return live()
        .filter((e) => e.entry_date >= a.p_from && e.entry_date <= a.p_to)
        .sort((x, y) => x.entry_date.localeCompare(y.entry_date))
        .flatMap((e) => journal_lines.filter((l) => l.entry_id === e.id && l.account_id === a.p_account_id).map((l) => {
          bal += l.debit - l.credit;
          return { line_id: l.id, entry_id: e.id, doc_number: e.doc_number, entry_date: e.entry_date, memo: e.memo, description: l.description,
            source_type: e.source_type, debit: l.debit, credit: l.credit, balance: bal };
        }));
    },
    finance_pending_counts: { invoice: 2, payment: 1, expense: 1, vendor_bill: 3, reverse: 1 },
    finance_sync: { posted: 7, reversed: 1, skipped: 0 },
    finance_setup: 0,
    finance_post_entry: eid(11),
    finance_post_expense: eid(12),
    finance_reverse_entry: eid(12),
  },
};
