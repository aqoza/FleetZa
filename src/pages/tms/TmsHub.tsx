/**
 * Transport management — module `tms`. Placeholder hub; replaced by the module build.
 */
import { PageHeader } from "../../components/ui";
import { useT } from "../../i18n";

export default function TmsHub() {
  const t = useT();
  return <PageHeader title={t("tms.title")} description={t("tms.subtitle")} />;
}
