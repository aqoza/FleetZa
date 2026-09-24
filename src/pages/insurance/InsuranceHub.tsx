/**
 * Insurance — module `insurance_mgmt`. Placeholder hub; replaced by the module build.
 */
import { PageHeader } from "../../components/ui";
import { useT } from "../../i18n";

export default function InsuranceHub() {
  const t = useT();
  return <PageHeader title={t("insurance.title")} description={t("insurance.subtitle")} />;
}
