/**
 * Field workforce — module `mobile_workforce`. Placeholder hub; replaced by the module build.
 */
import { PageHeader } from "../../components/ui";
import { useT } from "../../i18n";

export default function FieldHub() {
  const t = useT();
  return <PageHeader title={t("field.title")} description={t("field.subtitle")} />;
}
