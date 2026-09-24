/**
 * Documents — module `documents`. Placeholder hub; replaced by the module build.
 */
import { PageHeader } from "../../components/ui";
import { useT } from "../../i18n";

export default function DocumentsHub() {
  const t = useT();
  return <PageHeader title={t("documents.title")} description={t("documents.subtitle")} />;
}
