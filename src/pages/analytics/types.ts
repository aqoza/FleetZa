import { useQuery } from "@tanstack/react-query";
import { listRows } from "../../lib/db";
import type { Dimension, Period, WidgetSize, WidgetType } from "../../../shared/bi";

export interface BiDashboard {
  id: string;
  name: string;
  description: string | null;
  is_shared: boolean;
  owner_id: string | null;
  created_at: string;
  updated_at: string;
  widgets?: Array<{ count: number }>;
}

export interface BiWidget {
  id: string;
  dashboard_id: string;
  title: string | null;
  widget_type: WidgetType;
  metric: string;
  dimension: Dimension;
  period: Period;
  date_from: string | null;
  date_to: string | null;
  position: number;
  size: WidgetSize;
}

export const DASHBOARD_SELECT = "id, name, description, is_shared, owner_id, created_at, updated_at";
export const WIDGET_SELECT = "id, dashboard_id, title, widget_type, metric, dimension, period, date_from, date_to, position, size";

export function useWidgets(dashboardId: string) {
  return useQuery({
    queryKey: ["bi_widgets", dashboardId],
    enabled: !!dashboardId,
    queryFn: () =>
      listRows<BiWidget>("bi_widgets", (q) =>
        q.select(WIDGET_SELECT).eq("dashboard_id", dashboardId).order("position").order("created_at").limit(100)),
  });
}

export function todayIn(timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

/** Grid span of a widget on the 4-column dashboard grid. */
export const sizeClass: Record<WidgetSize, string> = {
  small: "lg:col-span-1",
  medium: "lg:col-span-2",
  large: "lg:col-span-4",
};
