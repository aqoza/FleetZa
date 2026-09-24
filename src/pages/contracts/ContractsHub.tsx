/**
 * Contracts — module `contracts`. Placeholder hub; replaced by the module build.
 */
import { PageHeader } from "../../components/ui";
import { useT } from "../../i18n";

export default function ContractsHub() {
  const t = useT();
  return <PageHeader title={t("contracts.title")} description={t("contracts.subtitle")} />;
}
