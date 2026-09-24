/**
 * Point of sale — module `pos`. Placeholder hub; replaced by the module build.
 */
import { PageHeader } from "../../components/ui";
import { useT } from "../../i18n";

export default function PosHub() {
  const t = useT();
  return <PageHeader title={t("pos.title")} description={t("pos.subtitle")} />;
}
