import { useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { apiFetch } from "../../lib/api";
import { useAuth } from "../../context/AuthContext";
import { Button, ErrorState, Field, Input, Select } from "../../components/ui";
import { AuthShell } from "./AuthShell";

const COMMON_CURRENCIES = [
  "USD", "EUR", "GBP", "INR", "AUD", "CAD", "JPY", "CNY", "AED", "SAR",
  "SGD", "CHF", "SEK", "NOK", "DKK", "NZD", "ZAR", "BRL", "MXN", "NGN",
  "KES", "EGP", "TRY", "PLN", "IDR", "MYR", "THB", "PHP", "VND", "KRW",
];

function browserTimezones(): string[] {
  try {
    return Intl.supportedValuesOf("timeZone");
  } catch {
    return ["UTC"];
  }
}

function countryOptions(): Array<{ code: string; name: string }> {
  const codes = [
    "US", "GB", "IN", "AU", "CA", "DE", "FR", "ES", "IT", "NL", "AE", "SA",
    "SG", "CH", "SE", "NO", "DK", "NZ", "ZA", "BR", "MX", "NG", "KE", "EG",
    "TR", "PL", "ID", "MY", "TH", "PH", "VN", "KR", "JP", "CN",
  ];
  try {
    const dn = new Intl.DisplayNames(undefined, { type: "region" });
    return codes
      .map((code) => ({ code, name: dn.of(code) ?? code }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return codes.map((code) => ({ code, name: code }));
  }
}

export default function SignupPage() {
  const { signIn } = useAuth();
  const navigate = useNavigate();

  const timezones = useMemo(browserTimezones, []);
  const countries = useMemo(countryOptions, []);
  const defaultTz = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC",
    [],
  );

  const [form, setForm] = useState({
    fullName: "",
    email: "",
    password: "",
    companyName: "",
    country: "US",
    currency: "USD",
    timezone: defaultTz,
    distanceUnit: "km" as "km" | "mi",
    volumeUnit: "L" as "L" | "gal",
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await apiFetch("/onboarding/signup", { body: form });
      await signIn(form.email.trim(), form.password);
      navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Signup failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell
      wide
      title="Create your organization"
      subtitle="Set up your fleet workspace — you can invite your team right after."
      footer={
        <>
          Already have an account?{" "}
          <Link to="/login" className="font-medium text-brand-600 hover:text-brand-700">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4">
        {error && <ErrorState message={error} />}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Your name" required>
            <Input
              value={form.fullName}
              onChange={(e) => set("fullName", e.target.value)}
              required
              autoComplete="name"
            />
          </Field>
          <Field label="Company / fleet name" required>
            <Input
              value={form.companyName}
              onChange={(e) => set("companyName", e.target.value)}
              required
            />
          </Field>
          <Field label="Email" required>
            <Input
              type="email"
              value={form.email}
              onChange={(e) => set("email", e.target.value)}
              required
              autoComplete="email"
            />
          </Field>
          <Field label="Password" required hint="At least 8 characters">
            <Input
              type="password"
              value={form.password}
              onChange={(e) => set("password", e.target.value)}
              required
              minLength={8}
              autoComplete="new-password"
            />
          </Field>
          <Field label="Country" required>
            <Select value={form.country} onChange={(e) => set("country", e.target.value)}>
              {countries.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Currency" required>
            <Select value={form.currency} onChange={(e) => set("currency", e.target.value)}>
              {COMMON_CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Timezone" required>
            <Select value={form.timezone} onChange={(e) => set("timezone", e.target.value)}>
              {timezones.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Distance">
              <Select
                value={form.distanceUnit}
                onChange={(e) => set("distanceUnit", e.target.value as "km" | "mi")}
              >
                <option value="km">Kilometers</option>
                <option value="mi">Miles</option>
              </Select>
            </Field>
            <Field label="Volume">
              <Select
                value={form.volumeUnit}
                onChange={(e) => set("volumeUnit", e.target.value as "L" | "gal")}
              >
                <option value="L">Liters</option>
                <option value="gal">Gallons (US)</option>
              </Select>
            </Field>
          </div>
        </div>

        <Button type="submit" loading={busy} className="w-full">
          Create organization
        </Button>
      </form>
    </AuthShell>
  );
}
