/**
 * Notifications — module `notifications`. Placeholder hub; replaced by the module build.
 */
import { PageHeader } from "../../components/ui";
import { useT } from "../../i18n";

export default function NotificationsHub() {
  const t = useT();
  return <PageHeader title={t("notifications.title")} description={t("notifications.subtitle")} />;
}
