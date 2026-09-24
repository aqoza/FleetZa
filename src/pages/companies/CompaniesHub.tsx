/**
 * Companies & branches — module `multi_company`. Placeholder hub; replaced by the module build.
 */
import { PageHeader } from "../../components/ui";
import { useT } from "../../i18n";

export default function CompaniesHub() {
  const t = useT();
  return <PageHeader title={t("companies.title")} description={t("companies.subtitle")} />;
}
