// Sidebar navigation registry — every entry belongs to a module so the nav
// adapts to what the tenant has enabled (see shared/modules.ts), and to a
// section so the sidebar groups by module-registry category. Dashboard and
// Settings are platform core: they borrow the alwaysOn "fleet" module for
// enablement but carry their own sections.
import {
  AlertTriangle,
  BarChart3,
  Building2,
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

export type NavSection =
  | "overview"
  | "fleet_ops"
  | "maintenance"
  | "compliance"
  | "customer"
  | "analytics"
  | "admin";

/** Display order + eyebrow label per sidebar section. */
export const NAV_SECTIONS: Array<{ id: NavSection; labelKey: MessageKey }> = [
  { id: "overview", labelKey: "nav.section.overview" },
  { id: "fleet_ops", labelKey: "nav.section.fleet_ops" },
  { id: "maintenance", labelKey: "nav.section.maintenance" },
  { id: "compliance", labelKey: "nav.section.compliance" },
  { id: "customer", labelKey: "nav.section.customer" },
  { id: "analytics", labelKey: "nav.section.analytics" },
  { id: "admin", labelKey: "nav.section.admin" },
];

export interface NavItem {
  moduleId: string;
  section: NavSection;
  to: string;
  labelKey: MessageKey;
  icon: LucideIcon;
  end?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { moduleId: "fleet", section: "overview", to: "/", labelKey: "nav.dashboard", icon: LayoutDashboard, end: true },

  { moduleId: "fleet", section: "fleet_ops", to: "/vehicles", labelKey: "nav.vehicles", icon: Truck },
  { moduleId: "drivers", section: "fleet_ops", to: "/drivers", labelKey: "nav.drivers", icon: Users },
  { moduleId: "fuel", section: "fleet_ops", to: "/fuel", labelKey: "nav.fuel", icon: Fuel },

  { moduleId: "maintenance", section: "maintenance", to: "/maintenance", labelKey: "nav.maintenance", icon: Wrench },
  { moduleId: "inspections", section: "maintenance", to: "/inspections", labelKey: "nav.inspections", icon: ClipboardCheck },
  { moduleId: "issues", section: "maintenance", to: "/issues", labelKey: "nav.issues", icon: AlertTriangle },

  { moduleId: "renewals", section: "compliance", to: "/renewals", labelKey: "nav.renewals", icon: ShieldCheck },
  { moduleId: "speed_limiters", section: "compliance", to: "/speed-limiters", labelKey: "nav.speedLimiters", icon: Gauge },

  { moduleId: "customers", section: "customer", to: "/customers", labelKey: "nav.customers", icon: Building2 },

  { moduleId: "reports", section: "analytics", to: "/reports", labelKey: "nav.reports", icon: BarChart3 },

  { moduleId: "fleet", section: "admin", to: "/settings", labelKey: "nav.settings", icon: Settings },
];
