import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { updateRow } from "../../lib/db";
import { defaultDocumentName, formatBytes, MAX_FILE_BYTES, parseTags } from "../../lib/documents";
import {
  useCustomerPicker, useDriverPicker, useEntityPicker, useVehiclePicker, type Picker,
} from "../../lib/pickers";
import type { Tables } from "../../lib/database.types";
import { useTenant } from "../../context/AuthContext";
import { useModules } from "../../context/ModulesContext";
import { useT } from "../../i18n";
import { Button, ErrorState, Field, Input, Select, Textarea } from "../../components/ui";
import { Combobox } from "../../components/Combobox";
import { useToast } from "../../components/Toast";
import { categoryLabels, linkTypes } from "./labels";
import { uploadDocument } from "./storage";
import { DOC_CATEGORIES, type DocCategory, type DocumentRow, type LinkType } from "./types";

/**
 * Upload a new document, or edit an existing one's details. `fixedLink`
 * attaches the document to a record (the panel on a vehicle page) and hides
 * the link fields.
 */
export function DocumentForm({
  document,
  fixedLink,
  onDone,
  onCancel,
}: {
  document?: DocumentRow;
  fixedLink?: { type: LinkType; id: string };
  onDone: (saved: DocumentRow) => void;
  onCancel: () => void;
}) {
  const t = useT();
  const tenant = useTenant();
  const qc = useQueryClient();
  const toast = useToast();
  const { isEnabled } = useModules();
  const availableLinks = (Object.keys(linkTypes) as LinkType[]).filter((k) => isEnabled(linkTypes[k].module));
  const existingLink = document?.entity_type && document.entity_type in linkTypes ? (document.entity_type as LinkType) : null;
  // A link this form cannot represent (an HR file, another module's record) is kept as is.
  const foreignLink = !!document?.entity_type && !existingLink;

  const [file, setFile] = useState<File | null>(null);
  const [form, setForm] = useState({
    name: document?.name ?? "",
    category: document?.category ?? ("general" as DocCategory),
    description: document?.description ?? "",
    expires_on: document?.expires_on ?? "",
    tags: (document?.tags ?? []).join(", "),
    link_type: (existingLink ?? "") as LinkType | "",
    link_id: existingLink ? document?.entity_id ?? "" : "",
  });
  const [error, setError] = useState("");

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  const linkType = form.link_type;
  const pickers: Record<LinkType, Picker> = {
    vehicle: useVehiclePicker(linkType === "vehicle" ? form.link_id : "", { enabled: linkType === "vehicle" }),
    driver: useDriverPicker(linkType === "driver" ? form.link_id : ""),
    customer: useCustomerPicker(linkType === "customer" ? form.link_id : "", { enabled: linkType === "customer" }),
    supplier: useEntityPicker<Tables<"suppliers">>({
      table: "suppliers",
      selectedId: linkType === "supplier" ? form.link_id : "",
      searchColumns: ["name", "name_ar", "doc_number"],
      orderBy: "name",
      toOption: (s) => ({ value: s.id, label: s.name, meta: s.doc_number ?? undefined }),
      scope: ["suppliers", "documents"],
      enabled: linkType === "supplier",
    }),
    employee: useEntityPicker<Tables<"employees">>({
      table: "employees",
      selectedId: linkType === "employee" ? form.link_id : "",
      searchColumns: ["first_name", "last_name", "doc_number"],
      orderBy: "first_name",
      toOption: (e) => ({ value: e.id, label: `${e.first_name} ${e.last_name ?? ""}`.trim(), meta: e.doc_number ?? undefined }),
      scope: ["employees", "documents"],
      enabled: linkType === "employee",
    }),
    incident: useEntityPicker<Tables<"incidents">>({
      table: "incidents",
      selectedId: linkType === "incident" ? form.link_id : "",
      searchColumns: ["doc_number", "location", "description"],
      orderBy: "occurred_at",
      ascending: false,
      toOption: (i) => ({ value: i.id, label: i.doc_number ?? i.id, meta: i.location ?? undefined }),
      scope: ["incidents", "documents"],
      enabled: linkType === "incident",
    }),
  };

  function pickFile(f: File | null) {
    setError("");
    setFile(f);
    if (f && !form.name.trim()) set("name", defaultDocumentName(f.name));
  }

  const mutation = useMutation({
    mutationFn: () => {
      const values: Record<string, unknown> = {
        name: form.name.trim(),
        category: form.category,
        description: form.description.trim() || null,
        expires_on: form.expires_on || null,
        tags: parseTags(form.tags),
      };
      if (fixedLink) {
        values.entity_type = fixedLink.type;
        values.entity_id = fixedLink.id;
      } else if (!foreignLink) {
        values.entity_type = form.link_type && form.link_id ? form.link_type : null;
        values.entity_id = form.link_type && form.link_id ? form.link_id : null;
      }
      if (document) return updateRow<DocumentRow>("documents", document.id, values);
      if (!file) throw new Error(t("documents.fileRequired"));
      if (file.size > MAX_FILE_BYTES) throw new Error(t("documents.fileTooLarge"));
      return uploadDocument(tenant.id, file, values);
    },
    onSuccess: (saved) => {
      void qc.invalidateQueries({ queryKey: ["documents"] });
      toast.success(document ? t("toast.saved") : t("documents.uploaded.toast"));
      onDone(saved);
    },
    onError: (err) => setError(err instanceof Error ? err.message : t("documents.saveFailed")),
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    mutation.mutate();
  }

  const tooBig = !!file && file.size > MAX_FILE_BYTES;

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {error && <ErrorState message={error} />}
      {document ? (
        <p className="text-xs text-ink-3">{t("documents.replaceFileHint")}</p>
      ) : (
        <Field
          label={t("documents.file")}
          required
          hint={file ? `${file.name} · ${formatBytes(file.size)}` : t("documents.fileHint")}
        >
          <input
            type="file"
            required
            onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
            className="block w-full text-sm text-ink-2 file:me-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-brand-700 hover:file:bg-brand-100"
          />
          {tooBig && <p className="mt-1 text-xs text-serious">{t("documents.fileTooLarge")}</p>}
        </Field>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("documents.name")} required>
          <Input value={form.name} onChange={(e) => set("name", e.target.value)} required maxLength={255} />
        </Field>
        <Field label={t("documents.category")}>
          <Select value={form.category} onChange={(e) => set("category", e.target.value as DocCategory)}>
            {DOC_CATEGORIES.map((c) => (
              <option key={c} value={c}>{t(categoryLabels[c])}</option>
            ))}
          </Select>
        </Field>
        <Field label={t("documents.expiresOn")} hint={t("documents.expiresOnHint")}>
          <Input type="date" dir="ltr" value={form.expires_on} onChange={(e) => set("expires_on", e.target.value)} />
        </Field>
        <Field label={t("documents.tags")} hint={t("documents.tagsHint")}>
          <Input value={form.tags} onChange={(e) => set("tags", e.target.value)} />
        </Field>
        {!fixedLink && !foreignLink && availableLinks.length > 0 && (
          <>
            <Field label={t("documents.linkType")}>
              <Select
                value={form.link_type}
                onChange={(e) => setForm((f) => ({ ...f, link_type: e.target.value as LinkType | "", link_id: "" }))}
              >
                <option value="">{t("documents.unlinked")}</option>
                {availableLinks.map((k) => (
                  <option key={k} value={k}>{t(linkTypes[k].labelKey)}</option>
                ))}
              </Select>
            </Field>
            {form.link_type && (
              <Field label={t("documents.linkRecord")}>
                <Combobox {...pickers[form.link_type]} value={form.link_id} onChange={(v) => set("link_id", v)} />
              </Field>
            )}
          </>
        )}
      </div>
      <Field label={t("documents.description")}>
        <Textarea value={form.description} onChange={(e) => set("description", e.target.value)} />
      </Field>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>{t("action.cancel")}</Button>
        <Button type="submit" loading={mutation.isPending} disabled={tooBig}>
          {document ? t("action.saveChanges") : mutation.isPending ? t("documents.uploading") : t("documents.upload")}
        </Button>
      </div>
    </form>
  );
}
