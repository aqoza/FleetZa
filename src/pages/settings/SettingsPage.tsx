import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ImageOff, Mail, Plus, Upload, Users } from "lucide-react";
import {
  COUNTRIES,
  getCountry,
  isSupportedCountry,
  middleEastCountries,
  otherCountries,
} from "../../../shared/countries";
import type { CountryConfig } from "../../../shared/countries";
import {
  CATEGORY_ORDER,
  MODULES,
  getModule,
  requirementsOf,
} from "../../../shared/modules";
import type { ModuleDef } from "../../../shared/modules";
import { apiFetch } from "../../lib/api";
import { insertRow, listRows, updateRow } from "../../lib/db";
import { formatDate } from "../../lib/format";
import type {
  DistanceUnit,
  Invitation,
  Profile,
  Role,
  Tenant,
  TenantArchetype,
  VolumeUnit,
} from "../../lib/types";
import { useAuth, useTenant } from "../../context/AuthContext";
import { useModules } from "../../context/ModulesContext";
import { useT, type MessageKey, type Translate } from "../../i18n";
import {
  Badge, Button, Card, EmptyState, ErrorState, Field, Input, LoadingState, Modal, PageHeader, Select, Table,
} from "../../components/ui";
import type { BadgeTone } from "../../components/ui";

// --- shared helpers (option lists mirror SignupPage) ---

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

function countryName(code: string): string {
  if (isSupportedCountry(code)) return getCountry(code).name;
  try {
    return new Intl.DisplayNames(undefined, { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

const roleTone: Record<Role, BadgeTone> = {
  owner: "purple",
  admin: "blue",
  manager: "green",
  viewer: "slate",
};

// --- Signature / stamp upload ---

// Stamp box heights offered in Settings, as a percent of the default. Bounded
// to match the tenants_stamp_scale_range check constraint: the mark sits in
// the closing strip of a one-page A4 document, so an unbounded value would
// silently push the certificate onto a second page.
const STAMP_SCALES = [75, 100, 125, 150, 175, 200] as const;

/**
 * A signature or stamp never prints larger than 84px tall on the certificate
 * (CertificatePrintPage.tsx), so a photo straight off a phone is far more
 * data than the document needs — this downscales to a generous retina cap
 * and re-encodes as PNG (keeping any transparency) before it ever becomes a
 * `data:` URL. The browser does the encoding; nothing here hand-builds or
 * retypes the resulting base64.
 */
const MARK_MAX_DIMENSION = 320;

function downscaleImageToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("decode failed"));
      img.onload = () => {
        const scale = Math.min(1, MARK_MAX_DIMENSION / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("no 2d context"));
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/png"));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

/**
 * The signature/stamp field: a preview, an upload button that reads a local
 * file through the browser's own canvas (see downscaleImageToDataUrl above),
 * and the original paste-a-link input for a tenant that hosts the mark
 * elsewhere. Either path lands in the same `data:`/`https:` string the save
 * mutation already sends.
 */
function MarkUploadField({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const t = useT();
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [uploadError, setUploadError] = useState("");

  async function handleFile(file: File) {
    setUploadError("");
    if (!file.type.startsWith("image/")) {
      setUploadError(t("settings.markUploadInvalidType"));
      return;
    }
    setBusy(true);
    try {
      onChange(await downscaleImageToDataUrl(file));
    } catch {
      setUploadError(t("settings.markUploadFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Field label={label} hint={hint} error={uploadError}>
      {/* Field wraps children in a bare <label>: with no `for`, a click
          anywhere inside — the Remove button, the text input — forwards to
          the first labelable descendant, which would be the hidden file
          input, popping a file picker on an unrelated click. One
          stopPropagation here keeps every control's own handler as the only
          thing that runs. */}
      <div className="flex items-start gap-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-dashed border-line bg-canvas">
          {value ? (
            <img src={value} alt="" className="max-h-full max-w-full object-contain" />
          ) : (
            <ImageOff className="h-5 w-5 text-ink-3" aria-hidden />
          )}
        </div>
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap gap-1.5">
            <Button
              type="button"
              variant="secondary"
              className="px-2.5 py-1.5 text-xs"
              loading={busy}
              onClick={(e) => {
                e.preventDefault();
                fileInput.current?.click();
              }}
            >
              <Upload className="h-3.5 w-3.5" /> {t("settings.uploadMark")}
            </Button>
            {value && (
              <Button
                type="button"
                variant="ghost"
                className="px-2.5 py-1.5 text-xs"
                onClick={(e) => {
                  e.preventDefault();
                  onChange("");
                }}
              >
                {t("action.remove")}
              </Button>
            )}
          </div>
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void handleFile(file);
            }}
          />
          <Input
            dir="ltr"
            placeholder={t("settings.markUrlPlaceholder")}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="text-xs"
          />
        </div>
      </div>
    </Field>
  );
}

// --- Organization tab ---

function OrganizationTab() {
  const t = useT();
  const tenant = useTenant();
  const { isAdmin, refresh } = useAuth();

  const timezones = useMemo(() => {
    const list = browserTimezones();
    return list.includes(tenant.timezone) ? list : [tenant.timezone, ...list];
  }, [tenant.timezone]);
  const currencies = useMemo(
    () =>
      CURRENCIES.includes(tenant.currency)
        ? CURRENCIES
        : [tenant.currency, ...CURRENCIES],
    [tenant.currency],
  );

  const [form, setForm] = useState({
    name: tenant.name,
    archetype: tenant.archetype,
    country: tenant.country,
    currency: tenant.currency,
    timezone: tenant.timezone,
    distance_unit: tenant.distance_unit,
    volume_unit: tenant.volume_unit,
    tax_registration_number: tenant.tax_registration_number ?? "",
    address: tenant.address ?? "",
    phone: tenant.phone ?? "",
    name_ar: tenant.name_ar ?? "",
    cr_number: tenant.cr_number ?? "",
    po_box: tenant.po_box ?? "",
    postal_code: tenant.postal_code ?? "",
    city: tenant.city ?? "",
    city_ar: tenant.city_ar ?? "",
    email: tenant.email ?? "",
    phone_secondary: tenant.phone_secondary ?? "",
    website: tenant.website ?? "",
    applicable_standard: tenant.applicable_standard ?? "",
    services_line: tenant.services_line ?? "",
    services_line_ar: tenant.services_line_ar ?? "",
    signature_url: tenant.signature_url ?? "",
    stamp_url: tenant.stamp_url ?? "",
    stamp_scale: String(tenant.stamp_scale ?? 100),
    signatory_name: tenant.signatory_name ?? "",
    signatory_name_ar: tenant.signatory_name_ar ?? "",
  });
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setSaved(false);
    setForm((f) => ({ ...f, [key]: value }));
  }

  const save = useMutation({
    mutationFn: async () => {
      await updateRow<Tenant>("tenants", tenant.id, {
        name: form.name.trim(),
        archetype: form.archetype,
        country: form.country,
        currency: form.currency,
        timezone: form.timezone,
        distance_unit: form.distance_unit,
        volume_unit: form.volume_unit,
        tax_registration_number: form.tax_registration_number.trim() || null,
        address: form.address.trim() || null,
        phone: form.phone.trim() || null,
        name_ar: form.name_ar.trim() || null,
        cr_number: form.cr_number.trim() || null,
        po_box: form.po_box.trim() || null,
        postal_code: form.postal_code.trim() || null,
        city: form.city.trim() || null,
        city_ar: form.city_ar.trim() || null,
        email: form.email.trim() || null,
        phone_secondary: form.phone_secondary.trim() || null,
        website: form.website.trim() || null,
        applicable_standard: form.applicable_standard.trim() || null,
        services_line: form.services_line.trim() || null,
        services_line_ar: form.services_line_ar.trim() || null,
        signature_url: form.signature_url.trim() || null,
        stamp_url: form.stamp_url.trim() || null,
        stamp_scale: Number(form.stamp_scale),
        signatory_name: form.signatory_name.trim() || null,
        signatory_name_ar: form.signatory_name_ar.trim() || null,
      });
      await refresh();
    },
    onSuccess: () => setSaved(true),
    onError: (err) => setError(err instanceof Error ? err.message : t("settings.saveFailed")),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    // Mirror the database's scheme allow-list so a bad paste is caught here
    // rather than as a constraint violation.
    const marks = [form.signature_url, form.stamp_url].map((u) => u.trim());
    if (marks.some((u) => u && !/^(https:\/\/|data:image\/)/.test(u))) {
      setError(t("settings.markUrlInvalid"));
      return;
    }
    // The website prints as plain text in the certificate footer, so it is
    // stored the way the dealer writes it on the letterhead — a bare domain.
    // A pasted "https://…/path" would print the whole URL, so it is caught here.
    const website = form.website.trim();
    if (website && !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9-]+)*\.[a-z]{2,}$/i.test(website)) {
      setError(t("settings.websiteInvalid"));
      return;
    }
    setError("");
    save.mutate();
  }

  if (!isAdmin) {
    const rows: Array<[string, string]> = [
      [t("field.name"), tenant.name],
      [
        t("settings.archetype"),
        tenant.archetype === "service_provider"
          ? t("settings.archetypeProvider")
          : t("settings.archetypeOperator"),
      ],
      [t("settings.country"), countryName(tenant.country)],
      [t("settings.currency"), tenant.currency],
      [t("settings.timezone"), tenant.timezone],
      [
        t("settings.distanceUnit"),
        tenant.distance_unit === "mi" ? t("settings.miles") : t("settings.kilometers"),
      ],
      [
        t("settings.volumeUnit"),
        tenant.volume_unit === "gal" ? t("settings.gallons") : t("settings.liters"),
      ],
      [t("settings.address"), tenant.address ?? t("common.dash")],
      [t("field.phone"), tenant.phone ?? t("common.dash")],
      [t("settings.created"), formatDate(tenant.created_at)],
    ];
    return (
      <Card className="max-w-2xl">
        <dl className="divide-y divide-slate-100">
          {rows.map(([label, value]) => (
            <div key={label} className="flex items-center justify-between gap-4 px-5 py-3">
              <dt className="text-sm font-medium text-slate-500">{label}</dt>
              <dd className="text-sm text-slate-800">{value}</dd>
            </div>
          ))}
        </dl>
      </Card>
    );
  }

  return (
    <div className="grid max-w-5xl items-start gap-4 lg:grid-cols-5">
      <Card className="p-5 lg:col-span-3">
        <form onSubmit={onSubmit} className="space-y-4">
          {error && <ErrorState message={error} />}

          <Field label={t("settings.orgName")} required>
            <Input value={form.name} onChange={(e) => set("name", e.target.value)} required />
          </Field>

          <Field label={t("settings.archetype")} hint={t("settings.archetypeHint")}>
            <Select
              value={form.archetype}
              onChange={(e) => set("archetype", e.target.value as TenantArchetype)}
            >
              <option value="fleet_operator">{t("settings.archetypeOperator")}</option>
              <option value="service_provider">{t("settings.archetypeProvider")}</option>
            </Select>
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label={t("settings.country")}
              required
              hint={
                form.country !== tenant.country
                  ? t("settings.countryChangeHint")
                  : undefined
              }
            >
              <Select value={form.country} onChange={(e) => set("country", e.target.value)}>
                {!isSupportedCountry(tenant.country) && (
                  <option value={tenant.country}>{countryName(tenant.country)}</option>
                )}
                <optgroup label={t("settings.middleEast")}>
                  {MIDDLE_EAST_OPTIONS.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.name}
                    </option>
                  ))}
                </optgroup>
                <optgroup label={t("settings.otherCountries")}>
                  {OTHER_OPTIONS.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.name}
                    </option>
                  ))}
                </optgroup>
              </Select>
            </Field>
            <Field label={t("settings.currency")} required>
              <Select value={form.currency} onChange={(e) => set("currency", e.target.value)}>
                {currencies.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("settings.timezone")} required>
              <Select value={form.timezone} onChange={(e) => set("timezone", e.target.value)}>
                {timezones.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label={t("settings.distance")}>
                <Select
                  value={form.distance_unit}
                  onChange={(e) => set("distance_unit", e.target.value as DistanceUnit)}
                >
                  <option value="km">{t("settings.kilometers")}</option>
                  <option value="mi">{t("settings.miles")}</option>
                </Select>
              </Field>
              <Field label={t("settings.volume")}>
                <Select
                  value={form.volume_unit}
                  onChange={(e) => set("volume_unit", e.target.value as VolumeUnit)}
                >
                  <option value="L">{t("settings.liters")}</option>
                  <option value="gal">{t("settings.gallons")}</option>
                </Select>
              </Field>
            </div>
          </div>

          <Field label={getCountry(form.country).tax.registrationLabel}>
            <Input
              value={form.tax_registration_number}
              onChange={(e) => set("tax_registration_number", e.target.value)}
              autoComplete="off"
            />
          </Field>

          {/* Dealer contact block — printed on RSL certificates. */}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("settings.address")} hint={t("settings.addressHint")}>
              <Input value={form.address} onChange={(e) => set("address", e.target.value)} />
            </Field>
            <Field label={t("field.phone")} hint={t("settings.phoneHint")}>
              <Input
                type="tel" dir="ltr"
                value={form.phone}
                onChange={(e) => set("phone", e.target.value)}
              />
            </Field>
          </div>

          {/* Document letterhead — masthead + footer strip of printed
              certificates (src/pages/speed-limiters/CertificatePrintPage.tsx). */}
          <fieldset className="space-y-4 border-t border-line pt-4">
            <legend className="sr-only">{t("settings.letterhead")}</legend>
            <div>
              <h3 className="text-sm font-semibold text-ink">{t("settings.letterhead")}</h3>
              <p className="mt-0.5 text-xs text-ink-3">{t("settings.letterheadHint")}</p>
            </div>

            <Field label={t("settings.nameAr")} hint={t("settings.nameArHint")}>
              <Input
                dir="rtl"
                value={form.name_ar}
                onChange={(e) => set("name_ar", e.target.value)}
              />
            </Field>

            <div className="grid gap-4 sm:grid-cols-3">
              <Field label={t("settings.crNumber")}>
                <Input
                  dir="ltr"
                  value={form.cr_number}
                  onChange={(e) => set("cr_number", e.target.value)}
                />
              </Field>
              <Field label={t("settings.poBox")}>
                <Input
                  dir="ltr"
                  value={form.po_box}
                  onChange={(e) => set("po_box", e.target.value)}
                />
              </Field>
              <Field label={t("settings.postalCode")}>
                <Input
                  dir="ltr"
                  value={form.postal_code}
                  onChange={(e) => set("postal_code", e.target.value)}
                />
              </Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("settings.city")} hint={t("settings.cityHint")}>
                <Input value={form.city} onChange={(e) => set("city", e.target.value)} />
              </Field>
              <Field label={t("settings.cityAr")}>
                <Input
                  dir="rtl"
                  value={form.city_ar}
                  onChange={(e) => set("city_ar", e.target.value)}
                />
              </Field>
              <Field label={t("settings.website")} hint={t("settings.websiteHint")}>
                <Input
                  dir="ltr"
                  inputMode="url"
                  value={form.website}
                  onChange={(e) => set("website", e.target.value)}
                />
              </Field>
              <Field label={t("settings.phoneSecondary")} hint={t("settings.phoneSecondaryHint")}>
                <Input
                  type="tel" dir="ltr"
                  value={form.phone_secondary}
                  onChange={(e) => set("phone_secondary", e.target.value)}
                />
              </Field>
              <Field label={t("settings.email")}>
                <Input
                  type="email" dir="ltr"
                  value={form.email}
                  onChange={(e) => set("email", e.target.value)}
                />
              </Field>
            </div>

            <Field
              label={t("settings.applicableStandard")}
              hint={t("settings.applicableStandardHint")}
            >
              <Input
                dir="ltr"
                placeholder="GSO-1026/2002"
                value={form.applicable_standard}
                onChange={(e) => set("applicable_standard", e.target.value)}
              />
            </Field>

            <Field label={t("settings.servicesLine")} hint={t("settings.servicesLineHint")}>
              <Input
                value={form.services_line}
                onChange={(e) => set("services_line", e.target.value)}
              />
            </Field>
            <Field label={t("settings.servicesLineAr")}>
              <Input
                dir="rtl"
                value={form.services_line_ar}
                onChange={(e) => set("services_line_ar", e.target.value)}
              />
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <MarkUploadField
                label={t("settings.signatureUrl")}
                hint={t("settings.markUrlHint")}
                value={form.signature_url}
                onChange={(value) => set("signature_url", value)}
              />
              <MarkUploadField
                label={t("settings.stampUrl")}
                hint={t("settings.markUrlHint")}
                value={form.stamp_url}
                onChange={(value) => set("stamp_url", value)}
              />
            </div>

            {/* Seals are scanned at wildly different crops, so one fixed box
                height renders some large and others tiny. Discrete steps
                rather than a free number: the mark sits in the closing strip
                of a one-page document, and the range is what keeps it there. */}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("settings.stampScale")} hint={t("settings.stampScaleHint")}>
                <Select
                  value={form.stamp_scale}
                  onChange={(e) => set("stamp_scale", e.target.value)}
                >
                  {STAMP_SCALES.map((scale) => (
                    <option key={scale} value={String(scale)}>
                      {scale === 100
                        ? t("settings.stampScaleDefault", { value: String(scale) })
                        : `${scale}%`}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("settings.signatoryName")} hint={t("settings.signatoryNameHint")}>
                <Input
                  value={form.signatory_name}
                  onChange={(e) => set("signatory_name", e.target.value)}
                />
              </Field>
              <Field
                label={t("settings.signatoryNameAr")}
                hint={t("settings.signatoryNameArHint")}
              >
                <Input
                  dir="rtl"
                  value={form.signatory_name_ar}
                  onChange={(e) => set("signatory_name_ar", e.target.value)}
                />
              </Field>
            </div>
          </fieldset>

          <div className="flex items-center justify-end gap-3">
            {saved && !save.isPending && (
              <span className="text-sm font-medium text-emerald-600">{t("settings.saved")}</span>
            )}
            <Button type="submit" loading={save.isPending}>
              {t("action.saveChanges")}
            </Button>
          </div>
        </form>
      </Card>

      <CountryProfileCard cfg={getCountry(tenant.country)} />
    </div>
  );
}

// --- Country profile card (read-only) ---

function CountryProfileCard({ cfg }: { cfg: CountryConfig }) {
  const t = useT();
  const currencySample = useMemo(() => {
    try {
      return new Intl.NumberFormat(cfg.locale, {
        style: "currency",
        currency: cfg.currency,
      }).format(1234.56);
    } catch {
      return `${cfg.currency} 1,234.56`;
    }
  }, [cfg]);

  const dateSample = useMemo(() => {
    try {
      return new Intl.DateTimeFormat(cfg.locale, { dateStyle: "medium" }).format(new Date());
    } catch {
      return new Date().toDateString();
    }
  }, [cfg]);

  return (
    <Card className="p-5 lg:col-span-2">
      <h2 className="text-sm font-semibold text-slate-900">{t("settings.countryProfile")}</h2>
      <p className="mt-1 text-xs text-slate-500">
        {t("settings.countryProfileDesc", { name: cfg.name })}
      </p>

      <dl className="mt-4 space-y-4">
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            {t("settings.currency")}
          </dt>
          <dd className="mt-1 text-sm text-slate-800">
            {cfg.currency}{" "}
            <span className="text-slate-500">
              {t("settings.egSample", { sample: currencySample })}
            </span>
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            {t("settings.dateFormat")}
          </dt>
          <dd className="mt-1 text-sm text-slate-800">{dateSample}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            {t("settings.tax")}
          </dt>
          <dd className="mt-1 text-sm text-slate-800">
            {cfg.tax.rate > 0
              ? `${cfg.tax.label} ${cfg.tax.rate}%`
              : t("settings.noTax", { label: cfg.tax.label })}
          </dd>
          {cfg.tax.note && <dd className="mt-1 text-xs text-slate-500">{cfg.tax.note}</dd>}
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            {t("settings.renewalDefaults")}
          </dt>
          <dd className="mt-1">
            <ul className="space-y-1.5">
              {cfg.regulations.renewals.map((r) => (
                <li
                  key={`${r.type}-${r.label}`}
                  className="flex items-baseline justify-between gap-3 text-sm"
                >
                  <span className="text-slate-700">{r.label}</span>
                  <span className="whitespace-nowrap text-xs text-slate-500">
                    {t("settings.everyMonths", { count: r.months })}
                  </span>
                </li>
              ))}
            </ul>
          </dd>
        </div>
      </dl>
    </Card>
  );
}

// --- Modules tab ---

const moduleNameKey = (id: string) => ("modules." + id + ".name") as MessageKey;
const moduleDescriptionKey = (id: string) => ("modules." + id + ".description") as MessageKey;

function ModuleCard({
  mod,
  pending,
  onToggle,
}: {
  mod: ModuleDef;
  pending: boolean;
  onToggle: (id: string, next: boolean) => void;
}) {
  const t = useT();
  const { isAdmin } = useAuth();
  const { isEnabled } = useModules();

  const enabled = isEnabled(mod.id);
  const missingRequirements =
    mod.status === "available" && !mod.alwaysOn && !enabled
      ? requirementsOf(mod.id).filter((dep) => !isEnabled(dep))
      : [];

  let badge: ReactNode;
  if (mod.alwaysOn) {
    badge = <Badge tone="blue">{t("settings.modules.badge.included")}</Badge>;
  } else if (enabled) {
    badge = <Badge tone="green">{t("settings.modules.badge.enabled")}</Badge>;
  } else if (mod.status === "coming_soon") {
    badge = <Badge tone="slate">{t("settings.modules.badge.comingSoon")}</Badge>;
  } else {
    badge = (
      <span className="inline-flex items-center rounded-full border border-slate-200 px-2 py-0.5 text-xs font-medium text-slate-500">
        {t("settings.modules.badge.available")}
      </span>
    );
  }

  return (
    <Card className="flex flex-col p-4">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-900">{t(moduleNameKey(mod.id))}</h3>
        <div className="shrink-0">{badge}</div>
      </div>
      <p className="mt-1 flex-1 text-xs leading-relaxed text-slate-500">
        {t(moduleDescriptionKey(mod.id))}
      </p>

      {isAdmin && !mod.alwaysOn && (
        <div className="mt-3">
          {mod.status === "coming_soon" ? (
            <Button variant="secondary" disabled className="px-3 py-1.5 text-xs">
              {t("settings.modules.comingSoon")}
            </Button>
          ) : enabled ? (
            <Button
              variant="secondary"
              className="px-3 py-1.5 text-xs"
              loading={pending}
              onClick={() => onToggle(mod.id, false)}
            >
              {t("settings.modules.disable")}
            </Button>
          ) : (
            <>
              <Button
                className="px-3 py-1.5 text-xs"
                loading={pending}
                onClick={() => onToggle(mod.id, true)}
              >
                {t("settings.modules.enable")}
              </Button>
              {missingRequirements.length > 0 && (
                <p className="mt-2 text-xs text-slate-500">
                  {t("settings.modules.willAlsoEnable", {
                    list: missingRequirements
                      .map((dep) => t(moduleNameKey(dep)))
                      .join(t("common.listSeparator")),
                  })}
                </p>
              )}
            </>
          )}
        </div>
      )}
    </Card>
  );
}

function ModulesTab() {
  const t = useT();
  const { setModuleEnabled } = useModules();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function toggle(id: string, next: boolean) {
    setPendingId(id);
    try {
      await setModuleEnabled(id, next);
      setError("");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.startsWith("DEPENDENTS:")) {
        const list = message
          .slice("DEPENDENTS:".length)
          .split(",")
          .filter((depId) => getModule(depId))
          .map((depId) => t(moduleNameKey(depId)))
          .join(t("common.listSeparator"));
        setError(t("settings.modules.blockedByDependents", { list }));
      } else {
        setError(message);
      }
    } finally {
      setPendingId(null);
    }
  }

  return (
    <div className="space-y-6">
      <p className="max-w-2xl text-sm text-slate-500">{t("settings.modules.intro")}</p>

      {error && <ErrorState message={error} />}

      {CATEGORY_ORDER.map((category) => {
        const mods = MODULES.filter((mod) => mod.category === category);
        if (mods.length === 0) return null;
        return (
          <section key={category}>
            <h2 className="mb-3 text-sm font-semibold text-slate-900">
              {t(`settings.modules.cat.${category}`)}
            </h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {mods.map((mod) => (
                <ModuleCard
                  key={mod.id}
                  mod={mod}
                  pending={pendingId === mod.id}
                  onToggle={(id, next) => void toggle(id, next)}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

// --- Members tab ---

function MembersTab() {
  const t = useT();
  const { profile, isAdmin } = useAuth();
  const qc = useQueryClient();
  const [actionError, setActionError] = useState("");
  const [removing, setRemoving] = useState<Profile | null>(null);

  const { data: members, isLoading, error } = useQuery({
    queryKey: ["profiles"],
    queryFn: () => listRows<Profile>("profiles", (q) => q.order("created_at")),
  });

  const changeRole = useMutation({
    mutationFn: ({ id, role }: { id: string; role: Role }) =>
      apiFetch("/members/" + id + "/role", { method: "PATCH", body: { role } }),
    onSuccess: () => {
      setActionError("");
      void qc.invalidateQueries({ queryKey: ["profiles"] });
    },
    onError: (err) =>
      setActionError(err instanceof Error ? err.message : t("settings.roleChangeFailed")),
  });

  const remove = useMutation({
    mutationFn: (id: string) => apiFetch("/members/" + id, { method: "DELETE" }),
    onSuccess: () => {
      setActionError("");
      void qc.invalidateQueries({ queryKey: ["profiles"] });
      setRemoving(null);
    },
    onError: (err) => {
      setRemoving(null);
      setActionError(err instanceof Error ? err.message : t("settings.removeFailed"));
    },
  });

  const canManage = (m: Profile) => isAdmin && m.role !== "owner" && m.id !== profile?.id;

  return (
    <>
      {actionError && (
        <div className="mb-4">
          <ErrorState message={actionError} />
        </div>
      )}

      {isLoading && <LoadingState />}
      {error && <ErrorState message={(error as Error).message} />}

      {!isLoading && !error && (members?.length ?? 0) === 0 && (
        <EmptyState
          icon={<Users className="h-10 w-10" />}
          title={t("settings.noMembers")}
          description={t("settings.noMembersDesc")}
        />
      )}

      {!isLoading && !error && (members?.length ?? 0) > 0 && (
        <Table
          headers={
            isAdmin
              ? [t("field.name"), t("settings.role"), t("settings.joined"), ""]
              : [t("field.name"), t("settings.role"), t("settings.joined")]
          }
        >
          {(members ?? []).map((m) => (
            <tr key={m.id} className="hover:bg-slate-50">
              <td className="px-4 py-3">
                <div className="font-medium text-slate-800">{m.full_name}</div>
                <div className="text-xs text-slate-500">{m.email}</div>
              </td>
              <td className="px-4 py-3">
                {canManage(m) ? (
                  <div className="w-32">
                    <Select
                      value={m.role}
                      onChange={(e) => changeRole.mutate({ id: m.id, role: e.target.value as Role })}
                      disabled={changeRole.isPending}
                      aria-label={t("settings.roleForAria", { name: m.full_name })}
                    >
                      <option value="admin">{t("role.admin")}</option>
                      <option value="manager">{t("role.manager")}</option>
                      <option value="viewer">{t("role.viewer")}</option>
                    </Select>
                  </div>
                ) : (
                  <Badge tone={roleTone[m.role]}>{t(`role.${m.role}`)}</Badge>
                )}
              </td>
              <td className="px-4 py-3 text-slate-600">{formatDate(m.created_at)}</td>
              {isAdmin && (
                <td className="px-4 py-3 text-end">
                  {canManage(m) && (
                    <button
                      className="rounded-md px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
                      onClick={() => setRemoving(m)}
                    >
                      {t("action.remove")}
                    </button>
                  )}
                </td>
              )}
            </tr>
          ))}
        </Table>
      )}

      <Modal title={t("settings.removeMember")} open={!!removing} onClose={() => setRemoving(null)}>
        {removing && (
          <>
            <p className="text-sm text-slate-600">
              {t("settings.removeMemberConfirmPre")}{" "}
              <span className="font-semibold">{removing.full_name}</span>{" "}
              {t("settings.removeMemberConfirmPost")}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setRemoving(null)}>
                {t("action.cancel")}
              </Button>
              <Button
                variant="danger"
                onClick={() => remove.mutate(removing.id)}
                loading={remove.isPending}
              >
                {t("settings.removeMember")}
              </Button>
            </div>
          </>
        )}
      </Modal>
    </>
  );
}

// --- Invitations tab ---

function InviteForm({ onDone }: { onDone: () => void }) {
  const t = useT();
  const tenant = useTenant();
  const { profile } = useAuth();
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Exclude<Role, "owner">>("viewer");
  const [error, setError] = useState("");

  const mutation = useMutation({
    mutationFn: () =>
      insertRow<Invitation>("invitations", {
        tenant_id: tenant.id,
        invited_by: profile?.id ?? null,
        email: email.trim(),
        role,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["invitations"] });
      onDone();
    },
    onError: (err) => setError(err instanceof Error ? err.message : t("settings.inviteFailed")),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    mutation.mutate();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {error && <ErrorState message={error} />}
      <Field label={t("field.email")} required>
        <Input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoComplete="off"
        />
      </Field>
      <Field label={t("settings.role")}>
        <Select
          value={role}
          onChange={(e) => setRole(e.target.value as Exclude<Role, "owner">)}
        >
          <option value="admin">{t("role.admin")}</option>
          <option value="manager">{t("role.manager")}</option>
          <option value="viewer">{t("role.viewer")}</option>
        </Select>
      </Field>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onDone}>{t("action.cancel")}</Button>
        <Button type="submit" loading={mutation.isPending}>{t("settings.createInvitation")}</Button>
      </div>
    </form>
  );
}

function invitationBadge(inv: Invitation, t: Translate) {
  if (inv.status === "accepted") return <Badge tone="green">{t("settings.statusAccepted")}</Badge>;
  if (inv.status === "revoked") return <Badge tone="slate">{t("settings.statusRevoked")}</Badge>;
  if (new Date(inv.expires_at).getTime() < Date.now())
    return <Badge tone="red">{t("settings.statusExpired")}</Badge>;
  return <Badge tone="yellow">{t("settings.statusPending")}</Badge>;
}

function InvitationsTab({
  inviting,
  setInviting,
}: {
  inviting: boolean;
  setInviting: (open: boolean) => void;
}) {
  const t = useT();
  const qc = useQueryClient();
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<Invitation | null>(null);
  const [actionError, setActionError] = useState("");

  const { data: invitations, isLoading, error } = useQuery({
    queryKey: ["invitations"],
    queryFn: () =>
      listRows<Invitation>("invitations", (q) => q.order("created_at", { ascending: false })),
  });

  const revoke = useMutation({
    mutationFn: (id: string) =>
      updateRow<Invitation>("invitations", id, { status: "revoked" }),
    onSuccess: () => {
      setActionError("");
      void qc.invalidateQueries({ queryKey: ["invitations"] });
      setRevoking(null);
    },
    onError: (err) => {
      setRevoking(null);
      setActionError(err instanceof Error ? err.message : t("settings.revokeFailed"));
    },
  });

  function copyLink(inv: Invitation) {
    void navigator.clipboard.writeText(
      window.location.origin + "/accept-invite?token=" + inv.token,
    );
    setCopiedId(inv.id);
    window.setTimeout(() => {
      setCopiedId((cur) => (cur === inv.id ? null : cur));
    }, 2000);
  }

  return (
    <>
      {actionError && (
        <div className="mb-4">
          <ErrorState message={actionError} />
        </div>
      )}

      {isLoading && <LoadingState />}
      {error && <ErrorState message={(error as Error).message} />}

      {!isLoading && !error && (invitations?.length ?? 0) === 0 && (
        <EmptyState
          icon={<Mail className="h-10 w-10" />}
          title={t("settings.noInvitations")}
          description={t("settings.noInvitationsDesc")}
          action={
            <Button onClick={() => setInviting(true)}>
              <Plus className="h-4 w-4" /> {t("settings.inviteMember")}
            </Button>
          }
        />
      )}

      {!isLoading && !error && (invitations?.length ?? 0) > 0 && (
        <>
          <Table
            headers={[
              t("field.email"),
              t("settings.role"),
              t("common.status"),
              t("settings.invited"),
              "",
            ]}
          >
            {(invitations ?? []).map((inv) => (
              <tr key={inv.id} className="hover:bg-slate-50">
                <td className="px-4 py-3 font-medium text-slate-800">{inv.email}</td>
                <td className="px-4 py-3 text-slate-600">{t(`role.${inv.role}`)}</td>
                <td className="px-4 py-3">{invitationBadge(inv, t)}</td>
                <td className="px-4 py-3 text-slate-600">{formatDate(inv.created_at)}</td>
                <td className="px-4 py-3 text-end">
                  {inv.status === "pending" && (
                    <div className="flex justify-end gap-2">
                      <button
                        className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                        onClick={() => copyLink(inv)}
                      >
                        {copiedId === inv.id ? t("action.copied") : t("action.copy")}
                      </button>
                      <button
                        className="rounded-md px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
                        onClick={() => setRevoking(inv)}
                      >
                        {t("settings.revoke")}
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </Table>
          <p className="mt-3 text-xs text-slate-500">{t("settings.inviteLinkHint")}</p>
        </>
      )}

      <Modal title={t("settings.inviteMember")} open={inviting} onClose={() => setInviting(false)}>
        <InviteForm onDone={() => setInviting(false)} />
      </Modal>

      <Modal
        title={t("settings.revokeInvitation")}
        open={!!revoking}
        onClose={() => setRevoking(null)}
      >
        {revoking && (
          <>
            <p className="text-sm text-slate-600">
              {t("settings.revokeInvitationConfirmPre")}{" "}
              <span className="font-semibold">{revoking.email}</span>
              {t("settings.revokeInvitationConfirmPost")}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setRevoking(null)}>
                {t("action.cancel")}
              </Button>
              <Button
                variant="danger"
                onClick={() => revoke.mutate(revoking.id)}
                loading={revoke.isPending}
              >
                {t("settings.revokeInvitation")}
              </Button>
            </div>
          </>
        )}
      </Modal>
    </>
  );
}

// --- Page ---

type Tab = "organization" | "modules" | "members" | "invitations";

const isModulesPath = (pathname: string) =>
  pathname === "/settings/modules" || pathname.startsWith("/settings/modules/");

export default function SettingsPage() {
  const t = useT();
  const { isAdmin } = useAuth();
  const { pathname } = useLocation();
  const [tab, setTab] = useState<Tab>(() =>
    isModulesPath(pathname) ? "modules" : "organization",
  );
  const [inviting, setInviting] = useState(false);

  // ModuleGate links to /settings/modules — land on (or switch to) the
  // Modules tab when the URL says so; tab clicks stay plain local state.
  useEffect(() => {
    if (isModulesPath(pathname)) setTab("modules");
  }, [pathname]);

  return (
    <>
      <PageHeader
        title={t("settings.title")}
        description={t("settings.subtitle")}
        actions={
          tab === "invitations" &&
          isAdmin && (
            <Button onClick={() => setInviting(true)}>
              <Plus className="h-4 w-4" /> {t("settings.inviteMember")}
            </Button>
          )
        }
      />

      <div className="mb-4 flex flex-wrap gap-2">
        {(
          [
            ["organization", "settings.tab.organization"],
            ["modules", "settings.tab.modules"],
            ["members", "settings.tab.members"],
            ["invitations", "settings.tab.invitations"],
          ] as const
        ).map(([value, labelKey]) => (
          <button
            key={value}
            onClick={() => setTab(value)}
            className={
              tab === value
                ? "rounded-full bg-brand-600 px-4 py-1.5 text-sm font-medium text-white shadow-sm"
                : "rounded-full border border-slate-300 bg-white px-4 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
            }
          >
            {t(labelKey)}
          </button>
        ))}
      </div>

      {tab === "organization" && <OrganizationTab />}
      {tab === "modules" && <ModulesTab />}
      {tab === "members" && <MembersTab />}
      {tab === "invitations" &&
        (isAdmin ? (
          <InvitationsTab inviting={inviting} setInviting={setInviting} />
        ) : (
          <Card className="max-w-2xl px-5 py-4 text-sm text-slate-500">
            {t("settings.adminsOnlyInvitations")}
          </Card>
        ))}
    </>
  );
}
