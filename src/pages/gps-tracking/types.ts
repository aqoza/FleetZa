export type GeofenceKind = "circle" | "polygon";
export type GeofenceColor = "blue" | "teal" | "amber" | "red";
export type PositionSource = "api" | "manual" | "import";

interface VehicleRef {
  vehicle: { name: string; license_plate: string | null } | null;
}

export interface LastPosition extends VehicleRef {
  vehicle_id: string;
  position_id: string;
  recorded_at: string;
  lat: number;
  lng: number;
  speed_kmh: number | null;
  heading: number | null;
  ignition: boolean | null;
  driver: { first_name: string; last_name: string } | null;
}

export interface Position extends VehicleRef {
  id: string;
  vehicle_id: string;
  recorded_at: string;
  lat: number;
  lng: number;
  speed_kmh: number | null;
  heading: number | null;
  odometer_km: number | null;
  source: PositionSource;
}

export interface Geofence {
  id: string;
  name: string;
  kind: GeofenceKind;
  center_lat: number | null;
  center_lng: number | null;
  radius_m: number | null;
  polygon: Array<[number, number]> | null;
  color: GeofenceColor;
  active: boolean;
  alert_on_enter: boolean;
  alert_on_exit: boolean;
  notes: string | null;
  created_at: string;
}

export interface GeofenceEvent extends VehicleRef {
  id: string;
  geofence_id: string;
  vehicle_id: string;
  event: "enter" | "exit";
  at: string;
  geofence: { name: string; color: GeofenceColor } | null;
}

export const VEHICLE_EMBED = "vehicle:vehicles!{fk}(name,license_plate)";
export const vehicleEmbed = (table: string) => VEHICLE_EMBED.replace("{fk}", `${table}_vehicle_id_fkey`);
