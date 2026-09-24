/**
 * Customer portal — module `customer_portal`. Placeholder hub; replaced by the module build.
 */
import { PageHeader } from "../../components/ui";
import { useT } from "../../i18n";

export default function CustomerPortalHub() {
  const t = useT();
  return <PageHeader title={t("customerPortal.title")} description={t("customerPortal.subtitle")} />;
}
