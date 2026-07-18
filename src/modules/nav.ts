// Sidebar navigation registry — every entry belongs to a module so the nav
// adapts to what the tenant has enabled (see shared/modules.ts).
// "fleet" is alwaysOn, so dashboard/vehicles/settings are always visible.
import {
  AlertTriangle,
  BarChart3,
  ClipboardCheck,
  Fuel,
  Gauge,
  LayoutDashboard,
  Settings,
  ShieldCheck,
  Truck,
  Users,
  Wrench,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { MessageKey } from "../i18n";

export const NAV_ITEMS: Array<{
  moduleId: string;
  to: string;
  labelKey: MessageKey;
  icon: LucideIcon;
  end?: boolean;
}> = [
  { moduleId: "fleet", to: "/", labelKey: "nav.dashboard", icon: LayoutDashboard, end: true },
  { moduleId: "fleet", to: "/vehicles", labelKey: "nav.vehicles", icon: Truck },
  { moduleId: "drivers", to: "/drivers", labelKey: "nav.drivers", icon: Users },
  { moduleId: "maintenance", to: "/maintenance", labelKey: "nav.maintenance", icon: Wrench },
  { moduleId: "fuel", to: "/fuel", labelKey: "nav.fuel", icon: Fuel },
  { moduleId: "inspections", to: "/inspections", labelKey: "nav.inspections", icon: ClipboardCheck },
  { moduleId: "issues", to: "/issues", labelKey: "nav.issues", icon: AlertTriangle },
  { moduleId: "renewals", to: "/renewals", labelKey: "nav.renewals", icon: ShieldCheck },
  { moduleId: "speed_limiters", to: "/speed-limiters", labelKey: "nav.speedLimiters", icon: Gauge },
  { moduleId: "reports", to: "/reports", labelKey: "nav.reports", icon: BarChart3 },
  { moduleId: "fleet", to: "/settings", labelKey: "nav.settings", icon: Settings },
];
