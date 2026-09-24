/**
 * GPS tracking — module `gps_tracking`. Placeholder hub; replaced by the module build.
 */
import { PageHeader } from "../../components/ui";
import { useT } from "../../i18n";

export default function GpsTrackingHub() {
  const t = useT();
  return <PageHeader title={t("gpsTracking.title")} description={t("gpsTracking.subtitle")} />;
}
