/**
 * Regulatory compliance — module `regulatory`. Placeholder hub; replaced by the module build.
 */
import { PageHeader } from "../../components/ui";
import { useT } from "../../i18n";

export default function RegulatoryHub() {
  const t = useT();
  return <PageHeader title={t("regulatory.title")} description={t("regulatory.subtitle")} />;
}
