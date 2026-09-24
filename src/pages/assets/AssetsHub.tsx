/**
 * Assets — module `assets`. Placeholder hub; replaced by the module build.
 */
import { PageHeader } from "../../components/ui";
import { useT } from "../../i18n";

export default function AssetsHub() {
  const t = useT();
  return <PageHeader title={t("assets.title")} description={t("assets.subtitle")} />;
}
