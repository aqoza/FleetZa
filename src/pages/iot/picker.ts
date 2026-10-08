import { useEntityPicker, type Picker } from "../../lib/pickers";

/** Server-searching IoT device picker (name or serial). */
export function useIotDevicePicker(selectedId: string): Picker {
  return useEntityPicker<{ id: string; name: string; serial: string }>({
    table: "iot_devices",
    selectedId,
    searchColumns: ["name", "serial"],
    orderBy: "name",
    toOption: (d) => ({ value: d.id, label: d.name, meta: d.serial, metaDir: "ltr" }),
    scope: ["iot_devices"],
  });
}
