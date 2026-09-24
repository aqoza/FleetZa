/**
 * Deliveries — module `logistics_delivery`. Placeholder hub; replaced by the module build.
 */
import { PageHeader } from "../../components/ui";
import { useT } from "../../i18n";

export default function DeliveriesHub() {
  const t = useT();
  return <PageHeader title={t("deliveries.title")} description={t("deliveries.subtitle")} />;
}
