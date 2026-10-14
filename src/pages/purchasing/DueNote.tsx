import { billDueIn } from "../../lib/purchasing";
import { useT, useTp } from "../../i18n";
import type { VendorBill } from "./types";

/** "Due in 3 days" / "2 days overdue" next to an unpaid bill's due date. */
export function DueNote({ bill, today }: { bill: VendorBill; today: string }) {
  const t = useT();
  const tp = useTp();
  const days = billDueIn(bill, today);
  if (days === null || days > 7) return null;
  if (days < 0) return <span className="text-xs font-medium text-serious">{tp("purchasing.overdueBy", -days)}</span>;
  if (days === 0) return <span className="text-xs font-medium text-warn">{t("purchasing.dueToday")}</span>;
  return <span className="text-xs text-ink-3">{tp("purchasing.dueIn", days)}</span>;
}
