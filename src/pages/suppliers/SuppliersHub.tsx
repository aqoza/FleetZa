/**
 * Suppliers — module `suppliers`. Placeholder hub; replaced by the module build.
 */
import { PageHeader } from "../../components/ui";
import { useT } from "../../i18n";

export default function SuppliersHub() {
  const t = useT();
  return <PageHeader title={t("suppliers.title")} description={t("suppliers.subtitle")} />;
}
