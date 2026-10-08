import { AlertOctagon, AlertTriangle, Info } from "lucide-react";
import type { Severity } from "../../lib/notifications";

const STYLES: Record<Severity, { icon: typeof Info; className: string }> = {
  info: { icon: Info, className: "bg-brand-50 text-brand-600" },
  warning: { icon: AlertTriangle, className: "bg-warn-soft text-warn" },
  critical: { icon: AlertOctagon, className: "bg-serious-soft text-serious" },
};

export function SeverityIcon({ severity }: { severity: Severity }) {
  const s = STYLES[severity] ?? STYLES.info;
  const Icon = s.icon;
  return (
    <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${s.className}`}>
      <Icon className="h-4 w-4" />
    </span>
  );
}
