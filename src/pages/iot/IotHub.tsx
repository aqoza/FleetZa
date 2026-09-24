/**
 * IoT devices — module `iot_devices`. Placeholder hub; replaced by the module build.
 */
import { PageHeader } from "../../components/ui";
import { useT } from "../../i18n";

export default function IotHub() {
  const t = useT();
  return <PageHeader title={t("iot.title")} description={t("iot.subtitle")} />;
}
