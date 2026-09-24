/**
 * CRM — module `crm`. Placeholder hub; replaced by the module build.
 */
import { PageHeader } from "../../components/ui";
import { useT } from "../../i18n";

export default function CrmHub() {
  const t = useT();
  return <PageHeader title={t("crm.title")} description={t("crm.subtitle")} />;
}
