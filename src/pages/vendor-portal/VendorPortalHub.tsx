/**
 * Vendor portal — module `vendor_portal`. Placeholder hub; replaced by the module build.
 */
import { PageHeader } from "../../components/ui";
import { useT } from "../../i18n";

export default function VendorPortalHub() {
  const t = useT();
  return <PageHeader title={t("vendorPortal.title")} description={t("vendorPortal.subtitle")} />;
}
