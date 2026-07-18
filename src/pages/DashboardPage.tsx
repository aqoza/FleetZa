import { useTenant } from "../context/AuthContext";
import OperatorDashboard from "./dashboard/OperatorDashboard";
import ProviderDashboard from "./dashboard/ProviderDashboard";

/**
 * The home dashboard adapts to the tenant's business type
 * (tenants.archetype, chosen at signup, editable in Settings):
 * fleet operators see their own fleet's health and spend;
 * service providers see the install-and-certify funnel.
 */
export default function DashboardPage() {
  const tenant = useTenant();
  return tenant.archetype === "service_provider" ? <ProviderDashboard /> : <OperatorDashboard />;
}
