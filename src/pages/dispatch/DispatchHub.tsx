/**
 * Dispatch — module `dispatch`. Placeholder hub; replaced by the module build.
 */
import { PageHeader } from "../../components/ui";
import { useT } from "../../i18n";

export default function DispatchHub() {
  const t = useT();
  return <PageHeader title={t("dispatch.title")} description={t("dispatch.subtitle")} />;
}
