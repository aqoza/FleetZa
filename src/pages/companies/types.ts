import type { Tables } from "../../lib/database.types";

export type Company = Tables<"companies">;
export type Branch = Tables<"branches">;

export interface BranchStats {
  branch_id: string;
  vehicle_count: number;
  driver_count: number;
  employee_count: number;
  warehouse_count: number;
}
