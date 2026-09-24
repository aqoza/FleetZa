/**
 * Trip planning — module `trip_planning`. Placeholder hub; replaced by the module build.
 */
import { PageHeader } from "../../components/ui";
import { useT } from "../../i18n";

export default function TripsHub() {
  const t = useT();
  return <PageHeader title={t("trips.title")} description={t("trips.subtitle")} />;
}
