import type { Database as GeneratedDatabase } from "./database.types";

// PostgreSQL does not expose RPC argument/result nullability to the type generator.
// Keep the SQL contracts here so database.types.ts can be regenerated verbatim.
type Functions = GeneratedDatabase["public"]["Functions"];
type Nullable<T, K extends keyof T> = { [P in keyof T]: P extends K ? T[P] | null : T[P] };
type NullableArgs<F extends keyof Functions, K extends keyof Functions[F]["Args"]> =
  Omit<Functions[F], "Args"> & { Args: Nullable<Functions[F]["Args"], K> };
type NullableRows<F extends keyof Functions, K extends keyof Row<F>> =
  Omit<Functions[F], "Returns"> & { Returns: Nullable<Row<F>, K>[] };
type Row<F extends keyof Functions> = Functions[F]["Returns"] extends (infer R)[] ? R : never;
type NullableArgsAndRows<F extends keyof Functions, A extends keyof Functions[F]["Args"], R extends keyof Row<F>> =
  Omit<NullableArgs<F, A>, "Returns"> & Pick<NullableRows<F, R>, "Returns">;

type RpcOverrides = {
  dispatch_assign: NullableArgs<"dispatch_assign", "p_driver_id">;
  dispatch_busy: NullableArgsAndRows<"dispatch_busy", "p_exclude", "doc_number">;
  field_checkin: NullableArgs<"field_checkin", "p_accuracy" | "p_employee" | "p_lat" | "p_lng" | "p_note" | "p_task">;
  field_task_transition: NullableArgs<"field_task_transition", "p_to">;
  leave_transition: NullableArgs<"leave_transition", "p_note">;
  purchase_receive: NullableArgs<"purchase_receive", "p_notes" | "p_warehouse">;
  request_leave: NullableArgs<"request_leave", "p_employee" | "p_reason">;
  trip_conflicts: NullableArgsAndRows<"trip_conflicts", "p_driver_id" | "p_exclude", "doc_number">;
  predictive_vehicle_health: NullableRows<"predictive_vehicle_health",
    "age_years" | "avg_daily_km" | "days_since_inspection" | "days_to_service" | "predicted_service_date">;
};

export type Database = Omit<GeneratedDatabase, "public"> & {
  public: Omit<GeneratedDatabase["public"], "Functions"> & {
    Functions: Omit<Functions, keyof RpcOverrides> & RpcOverrides;
  };
};
