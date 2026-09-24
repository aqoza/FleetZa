/**
 * Inventory — module `inventory`. Placeholder hub; replaced by the module build.
 */
import { PageHeader } from "../../components/ui";
import { useT } from "../../i18n";

export default function InventoryHub() {
  const t = useT();
  return <PageHeader title={t("inventory.title")} description={t("inventory.subtitle")} />;
}
