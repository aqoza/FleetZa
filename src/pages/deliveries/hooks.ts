import { useQuery } from "@tanstack/react-query";
import { listRows } from "../../lib/db";
import { DELIVERY_SELECT, ROUTE_SELECT, type Delivery, type DeliveryRoute } from "./types";

export function useRoute(id: string) {
  return useQuery({
    queryKey: ["delivery_routes", "detail", id],
    queryFn: async () =>
      (await listRows<DeliveryRoute>("delivery_routes", (q) => q.select(ROUTE_SELECT).eq("id", id).limit(1)))[0] ?? null,
  });
}

export function useRouteStops(id: string) {
  return useQuery({
    queryKey: ["deliveries", "route", id],
    queryFn: () =>
      listRows<Delivery>("deliveries", (q) => q.select(DELIVERY_SELECT).eq("route_id", id).order("sequence").limit(500)),
  });
}
