/**
 * Automation — module `workflow_automation`. Placeholder hub; replaced by the module build.
 */
import { PageHeader } from "../../components/ui";
import { useT } from "../../i18n";

export default function AutomationHub() {
  const t = useT();
  return <PageHeader title={t("automation.title")} description={t("automation.subtitle")} />;
}
