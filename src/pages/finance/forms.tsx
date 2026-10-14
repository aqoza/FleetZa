import { useState, type FormEvent, type ReactNode } from "react";
import { useT } from "../../i18n";
import { Button } from "../../components/ui";

export function useSubmit<T>(onDone: (v: T) => void) {
  const t = useT();
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const run = async (fn: () => Promise<T>) => {
    setSaving(true);
    setError("");
    try {
      onDone(await fn());
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.error"));
    } finally {
      setSaving(false);
    }
  };
  return { error, saving, run };
}

export function FormActions({ saving, label, onCancel, disabled, extra }: {
  saving: boolean; label: string; onCancel: () => void; disabled?: boolean; extra?: ReactNode;
}) {
  const t = useT();
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {extra}
      <Button type="button" variant="secondary" onClick={onCancel}>{t("action.cancel")}</Button>
      <Button type="submit" loading={saving} disabled={disabled}>{label}</Button>
    </div>
  );
}

export function FormError({ message }: { message: string }) {
  return message ? <p className="rounded-xl bg-serious-soft px-3 py-2 text-sm text-serious">{message}</p> : null;
}

export const numOrNull = (v: string) => (v.trim() === "" ? null : Number(v));
export const textOrNull = (v: string) => (v.trim() === "" ? null : v.trim());

/** Wraps a form's submit so callers write the body only. */
export function onSubmit(fn: () => void) {
  return (e: FormEvent) => {
    e.preventDefault();
    fn();
  };
}
