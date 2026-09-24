/**
 * Workshop — module `workshop`. Placeholder hub; replaced by the module build.
 */
import { PageHeader } from "../../components/ui";
import { useT } from "../../i18n";

export default function WorkshopHub() {
  const t = useT();
  return <PageHeader title={t("workshop.title")} description={t("workshop.subtitle")} />;
}
