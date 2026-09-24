/**
 * Employees — module `employees`. Placeholder hub; replaced by the module build.
 */
import { PageHeader } from "../../components/ui";
import { useT } from "../../i18n";

export default function EmployeesHub() {
  const t = useT();
  return <PageHeader title={t("employees.title")} description={t("employees.subtitle")} />;
}
