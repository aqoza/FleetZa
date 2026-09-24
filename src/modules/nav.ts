// Sidebar navigation registry — every entry belongs to a module so the nav
// adapts to what the tenant has enabled (see shared/modules.ts), and to a
// section so the sidebar groups by module-registry category. Dashboard and
// Settings are platform core: they borrow the alwaysOn "fleet" module for
// enablement but carry their own sections.
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Bell,
  Boxes,
  Briefcase,
  Building2,
  ChartPie,
  ClipboardCheck,
  Contact,
  Container,
  Cpu,
  Factory,
  FileSignature,
  FolderOpen,
  Fuel,
  Gauge,
  Globe,
  Hammer,
  Handshake,
  IdCard,
  Landmark,
  LayoutDashboard,
  Lock,
  MapPin,
  Network,
  Package,
  PackageCheck,
  Plug,
  Radar,
  ReceiptText,
  Route,
  Scale,
  Send,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Siren,
  Smartphone,
  Store,
  Truck,
  Umbrella,
  Users,
  Workflow,
  Wrench,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { MessageKey } from "../i18n";

export type NavSection =
  | "overview"
  | "fleet_ops"
  | "maintenance"
  | "compliance"
  | "logistics"
  | "commerce"
  | "finance"
  | "people"
  | "customer"
  | "analytics"
  | "platform"
  | "admin";

/** Display order + eyebrow label per sidebar section (mirrors CATEGORY_ORDER). */
export const NAV_SECTIONS: Array<{ id: NavSection; labelKey: MessageKey }> = [
  { id: "overview", labelKey: "nav.section.overview" },
  { id: "fleet_ops", labelKey: "nav.section.fleet_ops" },
  { id: "maintenance", labelKey: "nav.section.maintenance" },
  { id: "compliance", labelKey: "nav.section.compliance" },
  { id: "logistics", labelKey: "nav.section.logistics" },
  { id: "commerce", labelKey: "nav.section.commerce" },
  { id: "finance", labelKey: "nav.section.finance" },
  { id: "people", labelKey: "nav.section.people" },
  { id: "customer", labelKey: "nav.section.customer" },
  { id: "analytics", labelKey: "nav.section.analytics" },
  { id: "platform", labelKey: "nav.section.platform" },
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
  { moduleId: "gps_tracking", section: "fleet_ops", to: "/gps", labelKey: "nav.gpsTracking", icon: MapPin },
  { moduleId: "driver_behavior", section: "fleet_ops", to: "/driver-behavior", labelKey: "nav.driverBehavior", icon: Activity },
  { moduleId: "trip_planning", section: "fleet_ops", to: "/trips", labelKey: "nav.trips", icon: Route },
  { moduleId: "dispatch", section: "fleet_ops", to: "/dispatch", labelKey: "nav.dispatch", icon: Send },

  { moduleId: "maintenance", section: "maintenance", to: "/maintenance", labelKey: "nav.maintenance", icon: Wrench },
  { moduleId: "inspections", section: "maintenance", to: "/inspections", labelKey: "nav.inspections", icon: ClipboardCheck },
  { moduleId: "issues", section: "maintenance", to: "/issues", labelKey: "nav.issues", icon: AlertTriangle },
  { moduleId: "workshop", section: "maintenance", to: "/workshop", labelKey: "nav.workshop", icon: Hammer },
  { moduleId: "predictive_ai", section: "maintenance", to: "/predictive", labelKey: "nav.predictive", icon: Radar },

  { moduleId: "renewals", section: "compliance", to: "/renewals", labelKey: "nav.renewals", icon: ShieldCheck },
  { moduleId: "speed_limiters", section: "compliance", to: "/speed-limiters", labelKey: "nav.speedLimiters", icon: Gauge },
  { moduleId: "insurance_mgmt", section: "compliance", to: "/insurance", labelKey: "nav.insurance", icon: Umbrella },
  { moduleId: "incidents", section: "compliance", to: "/incidents", labelKey: "nav.incidents", icon: Siren },
  { moduleId: "regulatory", section: "compliance", to: "/regulatory", labelKey: "nav.regulatory", icon: Scale },

  { moduleId: "tms", section: "logistics", to: "/tms", labelKey: "nav.tms", icon: Container },
  { moduleId: "logistics_delivery", section: "logistics", to: "/deliveries", labelKey: "nav.deliveries", icon: PackageCheck },
  { moduleId: "inventory", section: "logistics", to: "/inventory", labelKey: "nav.inventory", icon: Package },
  { moduleId: "assets", section: "logistics", to: "/assets", labelKey: "nav.assets", icon: Boxes },

  { moduleId: "sales", section: "commerce", to: "/sales", labelKey: "nav.sales", icon: ReceiptText },
  { moduleId: "crm", section: "commerce", to: "/crm", labelKey: "nav.crm", icon: Handshake },
  { moduleId: "pos", section: "commerce", to: "/pos", labelKey: "nav.pos", icon: Store },
  { moduleId: "purchasing", section: "commerce", to: "/purchasing", labelKey: "nav.purchasing", icon: ShoppingCart },

  { moduleId: "finance", section: "finance", to: "/finance", labelKey: "nav.finance", icon: Landmark },
  { moduleId: "contracts", section: "finance", to: "/contracts", labelKey: "nav.contracts", icon: FileSignature },

  { moduleId: "employees", section: "people", to: "/employees", labelKey: "nav.employees", icon: IdCard },
  { moduleId: "payroll_hr", section: "people", to: "/hr", labelKey: "nav.hr", icon: Briefcase },
  { moduleId: "mobile_workforce", section: "people", to: "/field", labelKey: "nav.field", icon: Smartphone },

  { moduleId: "customers", section: "customer", to: "/customers", labelKey: "nav.customers", icon: Building2 },
  { moduleId: "suppliers", section: "customer", to: "/suppliers", labelKey: "nav.suppliers", icon: Factory },
  { moduleId: "customer_portal", section: "customer", to: "/customer-portal", labelKey: "nav.customerPortal", icon: Globe },
  { moduleId: "vendor_portal", section: "customer", to: "/vendor-portal", labelKey: "nav.vendorPortal", icon: Contact },

  { moduleId: "reports", section: "analytics", to: "/reports", labelKey: "nav.reports", icon: BarChart3 },
  { moduleId: "bi_analytics", section: "analytics", to: "/analytics", labelKey: "nav.analytics", icon: ChartPie },

  { moduleId: "documents", section: "platform", to: "/documents", labelKey: "nav.documents", icon: FolderOpen },
  { moduleId: "notifications", section: "platform", to: "/notifications", labelKey: "nav.notifications", icon: Bell },
  { moduleId: "workflow_automation", section: "platform", to: "/automation", labelKey: "nav.automation", icon: Workflow },
  { moduleId: "integrations", section: "platform", to: "/integrations", labelKey: "nav.integrations", icon: Plug },
  { moduleId: "iot_devices", section: "platform", to: "/iot", labelKey: "nav.iot", icon: Cpu },
  { moduleId: "audit_security", section: "platform", to: "/security", labelKey: "nav.security", icon: Lock },
  { moduleId: "multi_company", section: "platform", to: "/companies", labelKey: "nav.companies", icon: Network },

  { moduleId: "fleet", section: "admin", to: "/settings", labelKey: "nav.settings", icon: Settings },
];
