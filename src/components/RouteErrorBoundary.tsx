import { Component, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { useT } from "../i18n";
import { Button, Card } from "./ui";

function RouteFailure() {
  const t = useT();
  return (
    <div role="alert">
      <Card className="space-y-3 p-6">
        <h1 className="text-lg font-semibold text-ink">{t("common.pageLoadFailed")}</h1>
        <p className="text-sm text-ink-2">{t("common.pageLoadRetry")}</p>
        <Button onClick={() => window.location.reload()}>{t("common.reloadPage")}</Button>
      </Card>
    </div>
  );
}

class RouteBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? <RouteFailure /> : this.props.children;
  }
}

/** Keep navigation usable when a route chunk fails; a new route gets a fresh boundary. */
export function RouteErrorBoundary({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  return <RouteBoundary key={pathname}>{children}</RouteBoundary>;
}
