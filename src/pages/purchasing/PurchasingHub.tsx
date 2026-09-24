/**
 * Purchasing — module `purchasing`. Placeholder hub; replaced by the module build.
 */
import { PageHeader } from "../../components/ui";
import { useT } from "../../i18n";

export default function PurchasingHub() {
  const t = useT();
  return <PageHeader title={t("purchasing.title")} description={t("purchasing.subtitle")} />;
}
