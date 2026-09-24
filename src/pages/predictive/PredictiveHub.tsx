/**
 * Predictive maintenance — module `predictive_ai`. Placeholder hub; replaced by the module build.
 */
import { PageHeader } from "../../components/ui";
import { useT } from "../../i18n";

export default function PredictiveHub() {
  const t = useT();
  return <PageHeader title={t("predictive.title")} description={t("predictive.subtitle")} />;
}
