/**
 * Finance — module `finance`. Placeholder hub; replaced by the module build.
 */
import { PageHeader } from "../../components/ui";
import { useT } from "../../i18n";

export default function FinanceHub() {
  const t = useT();
  return <PageHeader title={t("finance.title")} description={t("finance.subtitle")} />;
}
