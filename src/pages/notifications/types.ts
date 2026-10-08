import type { Tables } from "../../lib/database.types";
import type { Severity } from "../../lib/notifications";

export type NotificationRow = Omit<Tables<"notifications">, "severity"> & { severity: Severity };
export type NotificationPreference = Tables<"notification_preferences">;
