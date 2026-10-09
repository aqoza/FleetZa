import { useState } from "react";
import { insertRow, updateRow } from "../../lib/db";
import { useT } from "../../i18n";
import { Field, Input, Textarea } from "../../components/ui";
import { FormActions, FormError, onSubmit, textOrNull, useSubmit } from "./forms";
import type { BiDashboard } from "./types";

export function DashboardForm({ dashboard, onCancel, onDone }: {
  dashboard: BiDashboard | null; onCancel: () => void; onDone: (id: string) => void;
}) {
  const t = useT();
  const [name, setName] = useState(dashboard?.name ?? "");
  const [description, setDescription] = useState(dashboard?.description ?? "");
  const [shared, setShared] = useState(dashboard?.is_shared ?? true);
  const { error, saving, run } = useSubmit<string>(onDone);
  const submit = onSubmit(() => run(async () => {
    const values = { name: name.trim(), description: textOrNull(description), is_shared: shared };
    if (dashboard) {
      await updateRow("bi_dashboards", dashboard.id, values);
      return dashboard.id;
    }
    return (await insertRow<{ id: string }>("bi_dashboards", values)).id;
  }));
  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label={t("analytics.name")} required>
        <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required autoFocus />
      </Field>
      <Field label={t("analytics.description")}>
        <Textarea rows={2} maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <label className="flex items-start gap-2 text-sm text-ink">
        <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-line" />
        <span>
          {t("analytics.shared")}
          <span className="block text-xs text-ink-3">{t("analytics.sharedHint")}</span>
        </span>
      </label>
      <FormError message={error} />
      <FormActions saving={saving} label={dashboard ? t("analytics.save") : t("analytics.create")} onCancel={onCancel} />
    </form>
  );
}
