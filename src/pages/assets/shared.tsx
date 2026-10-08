import { Badge } from "../../components/ui";
import { daysUntil } from "../../lib/format";
import { useT, useTp } from "../../i18n";

/** Warranty state for dates inside the 30-day window or past; nothing otherwise. */
export function WarrantyBadge({ expiry }: { expiry: string | null }) {
  const t = useT();
  const tp = useTp();
  if (!expiry) return null;
  const days = daysUntil(expiry);
  if (days < 0) return <Badge tone="slate">{t("assets.warrantyEnded")}</Badge>;
  if (days === 0) return <Badge tone="red">{t("assets.warrantyToday")}</Badge>;
  if (days <= 30) return <Badge tone={days <= 7 ? "red" : "yellow"}>{tp("assets.warrantyIn", days)}</Badge>;
  return null;
}
