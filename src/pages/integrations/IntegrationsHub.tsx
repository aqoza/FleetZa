/**
 * Integrations — module `integrations`. Placeholder hub; replaced by the module build.
 */
import { PageHeader } from "../../components/ui";
import { useT } from "../../i18n";

export default function IntegrationsHub() {
  const t = useT();
  return <PageHeader title={t("integrations.title")} description={t("integrations.subtitle")} />;
}
