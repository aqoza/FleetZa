import { useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  COUNTRIES,
  getCountry,
  middleEastCountries,
  otherCountries,
} from "../../../shared/countries";
import { apiFetch } from "../../lib/api";
import { useAuth } from "../../context/AuthContext";
import { Button, ErrorState, Field, Input, Select } from "../../components/ui";
import { useT } from "../../i18n";
import { AuthShell } from "./AuthShell";

const CURRENCIES = Array.from(
  new Set(Object.values(COUNTRIES).map((c) => c.currency)),
).sort();
const MIDDLE_EAST_OPTIONS = middleEastCountries();
const OTHER_OPTIONS = otherCountries();

function browserTimezones(): string[] {
  try {
    return Intl.supportedValuesOf("timeZone");
  } catch {
    return ["UTC"];
  }
}

export default function SignupPage() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const t = useT();

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

  const timezones = useMemo(() => {
    const list = browserTimezones();
    return list.includes(form.timezone) ? list : [form.timezone, ...list];
  }, [form.timezone]);

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  /** Picking a country auto-fills its defaults; the fields stay editable. */
  function pickCountry(code: string) {
    const cfg = getCountry(code);
    setForm((f) => ({
      ...f,
      country: code,
      currency: cfg.currency,
      timezone: cfg.timezone,
      distanceUnit: cfg.distanceUnit,
      volumeUnit: cfg.volumeUnit,
    }));
  }

  const tax = getCountry(form.country).tax;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await apiFetch("/onboarding/signup", { body: form });
      await signIn(form.email.trim(), form.password);
      navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : t("auth.signupFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell
      wide
      title={t("auth.createOrg")}
      subtitle={t("auth.createOrgSubtitle")}
      footer={
        <>
          {t("auth.haveAccount")}{" "}
          <Link to="/login" className="font-medium text-brand-600 hover:text-brand-700">
            {t("auth.signIn")}
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4">
        {error && <ErrorState message={error} />}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("field.fullName")} required>
            <Input
              value={form.fullName}
              onChange={(e) => set("fullName", e.target.value)}
              required
              autoComplete="name"
            />
          </Field>
          <Field label={t("auth.companyName")} required>
            <Input
              value={form.companyName}
              onChange={(e) => set("companyName", e.target.value)}
              required
            />
          </Field>
          <Field label={t("field.email")} required>
            <Input
              type="email"
              value={form.email}
              onChange={(e) => set("email", e.target.value)}
              required
              autoComplete="email"
            />
          </Field>
          <Field label={t("field.password")} required hint={t("auth.atLeast8")}>
            <Input
              type="password"
              value={form.password}
              onChange={(e) => set("password", e.target.value)}
              required
              minLength={8}
              autoComplete="new-password"
            />
          </Field>
          <Field
            label={t("auth.country")}
            required
            hint={
              tax.rate > 0
                ? t("auth.taxHint", { label: tax.label, rate: tax.rate })
                : undefined
            }
          >
            <Select value={form.country} onChange={(e) => pickCountry(e.target.value)}>
              <optgroup label={t("auth.middleEast")}>
                {MIDDLE_EAST_OPTIONS.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name}
                  </option>
                ))}
              </optgroup>
              <optgroup label={t("auth.otherCountries")}>
                {OTHER_OPTIONS.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name}
                  </option>
                ))}
              </optgroup>
            </Select>
          </Field>
          <Field label={t("auth.currency")} required>
            <Select value={form.currency} onChange={(e) => set("currency", e.target.value)}>
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("auth.timezone")} required>
            <Select value={form.timezone} onChange={(e) => set("timezone", e.target.value)}>
              {timezones.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label={t("auth.distance")}>
              <Select
                value={form.distanceUnit}
                onChange={(e) => set("distanceUnit", e.target.value as "km" | "mi")}
              >
                <option value="km">{t("auth.kilometers")}</option>
                <option value="mi">{t("auth.miles")}</option>
              </Select>
            </Field>
            <Field label={t("auth.volume")}>
              <Select
                value={form.volumeUnit}
                onChange={(e) => set("volumeUnit", e.target.value as "L" | "gal")}
              >
                <option value="L">{t("auth.liters")}</option>
                <option value="gal">{t("auth.gallons")}</option>
              </Select>
            </Field>
          </div>
        </div>

        <Button type="submit" loading={busy} className="w-full">
          {t("auth.createOrganization")}
        </Button>
      </form>
    </AuthShell>
  );
}
