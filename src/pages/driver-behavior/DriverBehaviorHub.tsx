/**
 * Driver behavior — module `driver_behavior`. Placeholder hub; replaced by the module build.
 */
import { PageHeader } from "../../components/ui";
import { useT } from "../../i18n";

export default function DriverBehaviorHub() {
  const t = useT();
  return <PageHeader title={t("driverBehavior.title")} description={t("driverBehavior.subtitle")} />;
}
