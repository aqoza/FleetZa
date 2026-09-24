/**
 * HR & payroll — module `payroll_hr`. Placeholder hub; replaced by the module build.
 */
import { PageHeader } from "../../components/ui";
import { useT } from "../../i18n";

export default function HrHub() {
  const t = useT();
  return <PageHeader title={t("hr.title")} description={t("hr.subtitle")} />;
}
