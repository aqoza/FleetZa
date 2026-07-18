import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Blocks } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useModules } from "../context/ModulesContext";
import { useT } from "../i18n";
import { Button, EmptyState, LoadingState } from "./ui";

/**
 * Renders children only when the module is enabled for the tenant.
 * Otherwise shows a friendly "not enabled" screen (admins get a link to the
 * module catalog in Settings). Wrap every module-owned route element with this.
 */
export function ModuleGate({ module, children }: { module: string; children: ReactNode }) {
  const { isEnabled, loading } = useModules();
  const { isAdmin } = useAuth();
  const t = useT();

  if (loading) return <LoadingState />;
  if (isEnabled(module)) return <>{children}</>;

  return (
    <EmptyState
      icon={<Blocks className="h-10 w-10" />}
      title={t("modules.gate.title")}
      description={isAdmin ? t("modules.gate.adminHint") : t("modules.gate.memberHint")}
      action={
        isAdmin ? (
          <Link to="/settings/modules">
            <Button>{t("modules.gate.manage")}</Button>
          </Link>
        ) : undefined
      }
    />
  );
}
