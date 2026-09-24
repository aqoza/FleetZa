/**
 * BI analytics — module `bi_analytics`. Placeholder hub; replaced by the module build.
 */
import { PageHeader } from "../../components/ui";
import { useT } from "../../i18n";

export default function AnalyticsHub() {
  const t = useT();
  return <PageHeader title={t("analytics.title")} description={t("analytics.subtitle")} />;
}
