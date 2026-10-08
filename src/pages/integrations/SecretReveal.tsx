import { useState } from "react";
import { Check, Copy, KeyRound } from "lucide-react";
import { useT } from "../../i18n";
import { Button } from "../../components/ui";

/** A secret shown exactly once (API key, webhook signing secret), with copy. */
export function SecretReveal({ label, value, onDone }: { label: string; value: string; onDone: () => void }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2 rounded-lg bg-warn-soft px-3 py-2 text-sm text-ink-2">
        <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-warn" />
        <span>{t("integrations.secretOnce")}</span>
      </div>
      <div>
        <div className="mb-1 text-sm font-medium text-ink-2">{label}</div>
        <div className="flex items-stretch gap-2">
          <code
            dir="ltr"
            className="min-w-0 flex-1 select-all break-all rounded-lg border border-line bg-canvas px-3 py-2 font-mono text-xs text-ink"
          >
            {value}
          </code>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              void navigator.clipboard?.writeText(value).then(() => setCopied(true));
            }}
          >
            {copied ? <Check className="h-4 w-4 text-good" /> : <Copy className="h-4 w-4" />}
            {copied ? t("integrations.copied") : t("integrations.copy")}
          </Button>
        </div>
      </div>
      <div className="flex justify-end">
        <Button type="button" onClick={onDone}>{t("integrations.done")}</Button>
      </div>
    </div>
  );
}
