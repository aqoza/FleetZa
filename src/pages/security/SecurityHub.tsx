/**
 * Audit & security — module `audit_security`. Placeholder hub; replaced by the module build.
 */
import { PageHeader } from "../../components/ui";
import { useT } from "../../i18n";

export default function SecurityHub() {
  const t = useT();
  return <PageHeader title={t("security.title")} description={t("security.subtitle")} />;
}
