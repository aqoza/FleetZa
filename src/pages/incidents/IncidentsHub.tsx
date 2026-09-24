/**
 * Incidents — module `incidents`. Placeholder hub; replaced by the module build.
 */
import { PageHeader } from "../../components/ui";
import { useT } from "../../i18n";

export default function IncidentsHub() {
  const t = useT();
  return <PageHeader title={t("incidents.title")} description={t("incidents.subtitle")} />;
}
