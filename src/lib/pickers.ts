/**
 * Server-searching option sources for `<Combobox>`.
 *
 * Every reference dropdown in the app used to load a page of rows and render
 * it whole, which quietly broke once a table outgrew the page: this tenant has
 * 477 vehicles behind a 200-row ceiling. These hooks turn each picker into a
 * search — the typed term goes to Postgres, and only the matches come back.
 *
 * Two rules hold everywhere:
 *  - The selected row is fetched by id and merged in, because it is usually
 *    not in the first page of an unfiltered search. Without it, opening an old
 *    document would show an empty box over a perfectly good foreign key.
 *  - Search columns are the ones a human would type: a plate, a serial, a CR
 *    number — not just the display name.
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getRow, listRows, sanitizeSearch, type DbFilter, type TableName } from "./db";
import type { ComboboxOption } from "../components/Combobox";
import type {
  Contact, Customer, Driver, Product, SlDevice, SlTechnician, Vehicle,
} from "./types";

/** Rows per search. Small on purpose — a combobox is read at a glance, and a
 *  term that matches more than this wants refining, not scrolling. */
const PICKER_PAGE = 20;

/** Exactly the props `<Combobox>` needs, so call sites can spread the hook. */
export interface Picker {
  options: ComboboxOption[];
  loading: boolean;
  onSearch: (term: string) => void;
}

interface PickerConfig<T> {
  table: TableName;
  /** Selected id, so its row can be merged in even when it is off-page. */
  selectedId: string;
  /** Columns matched with `ilike` against the typed term. */
  searchColumns: string[];
  orderBy: string;
  ascending?: boolean;
  toOption: (row: T) => ComboboxOption;
  /** Non-search narrowing (status, ownership, parent record). */
  filter?: (q: DbFilter) => DbFilter;
  /** Anything the filter depends on — it discriminates the query cache. */
  scope?: Array<string | number | boolean | null | undefined>;
  enabled?: boolean;
}

function useEntityPicker<T extends { id: string }>({
  table,
  selectedId,
  searchColumns,
  orderBy,
  ascending = true,
  toOption,
  filter,
  scope = [],
  enabled = true,
}: PickerConfig<T>): Picker {
  const [raw, setRaw] = useState("");
  const [term, setTerm] = useState("");

  // Debounced so a five-letter plate is one query, not five.
  useEffect(() => {
    const id = setTimeout(() => setTerm(sanitizeSearch(raw)), 200);
    return () => clearTimeout(id);
  }, [raw]);

  const listQ = useQuery({
    queryKey: ["picker", table, scope, term],
    enabled,
    queryFn: () =>
      listRows<T>(table, (q) => {
        let b = filter ? filter(q) : q;
        if (term) {
          b = b.or(searchColumns.map((c) => `${c}.ilike.%${term}%`).join(","));
        }
        return b.order(orderBy, { ascending }).limit(PICKER_PAGE);
      }),
    staleTime: 60_000,
  });

  // Deliberately not narrowed by `filter`: an inactive customer or a device
  // that has since been installed elsewhere is still what this record points
  // at, and hiding it would look like data loss.
  const selectedQ = useQuery({
    queryKey: ["picker-row", table, selectedId],
    enabled: enabled && Boolean(selectedId),
    queryFn: () => getRow<T>(table, selectedId),
    staleTime: 300_000,
  });

  const options = useMemo(() => {
    const rows = listQ.data ?? [];
    const out = rows.map(toOption);
    const picked = selectedQ.data;
    if (picked && !rows.some((r) => r.id === picked.id)) out.unshift(toOption(picked));
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- toOption is inline at every call site
  }, [listQ.data, selectedQ.data]);

  return { options, loading: listQ.isFetching, onSearch: setRaw };
}

// --- Concrete pickers ----------------------------------------------------

const vehicleLabel = (v: Vehicle): ComboboxOption => ({
  value: v.id,
  label: v.name,
  meta: v.license_plate ?? v.fleet_number ?? v.vin ?? undefined,
});

export function useVehiclePicker(
  selectedId: string,
  opts: {
    customerId?: string | null;
    ownership?: Vehicle["ownership"];
    /** Keep vehicles with no owner in a customer-scoped list. */
    includeUnassigned?: boolean;
    /** Only vehicles no customer owns yet — the "attach to customer" case. */
    unassignedOnly?: boolean;
    enabled?: boolean;
  } = {},
): Picker {
  const { customerId, ownership, includeUnassigned = false, unassignedOnly = false, enabled } = opts;
  return useEntityPicker<Vehicle>({
    table: "vehicles",
    selectedId,
    // Plate and VIN first in a user's mind; chassis/fleet numbers are how the
    // speed-limiter side of the business identifies a truck.
    searchColumns: ["name", "license_plate", "vin", "chassis_number", "fleet_number"],
    orderBy: "name",
    toOption: vehicleLabel,
    filter: (q) => {
      let b = q;
      if (unassignedOnly) b = b.is("customer_id", null);
      else if (customerId) {
        // A second `.or()` is ANDed with the search term's — PostgREST treats
        // repeated `or` params as separate conjuncts, which is what we want.
        b = includeUnassigned
          ? b.or(`customer_id.eq.${customerId},customer_id.is.null`)
          : b.eq("customer_id", customerId);
      }
      if (ownership) b = b.eq("ownership", ownership);
      return b;
    },
    scope: ["vehicles", customerId, ownership, includeUnassigned, unassignedOnly],
    enabled,
  });
}

export function useCustomerPicker(
  selectedId: string,
  opts: { activeOnly?: boolean; enabled?: boolean } = {},
): Picker {
  const { activeOnly = false, enabled } = opts;
  return useEntityPicker<Customer>({
    table: "customers",
    selectedId,
    searchColumns: ["name", "cr_number", "phone", "email"],
    orderBy: "name",
    toOption: (c) => ({ value: c.id, label: c.name, meta: c.cr_number ?? undefined }),
    filter: activeOnly ? (q) => q.eq("status", "active") : undefined,
    scope: ["customers", activeOnly],
    enabled,
  });
}

export function useContactPicker(selectedId: string, customerId: string): Picker {
  return useEntityPicker<Contact>({
    table: "contacts",
    selectedId,
    searchColumns: ["name", "email", "phone", "title"],
    orderBy: "name",
    toOption: (c) => ({ value: c.id, label: c.name, meta: c.title ?? undefined }),
    filter: (q) => q.eq("customer_id", customerId),
    scope: ["contacts", customerId],
    enabled: Boolean(customerId),
  });
}

export function useDriverPicker(
  selectedId: string,
  opts: { activeOnly?: boolean } = {},
): Picker {
  const { activeOnly = false } = opts;
  return useEntityPicker<Driver>({
    table: "drivers",
    selectedId,
    searchColumns: ["first_name", "last_name", "phone", "license_number"],
    orderBy: "first_name",
    toOption: (d) => ({
      value: d.id,
      label: `${d.first_name} ${d.last_name}`,
      meta: d.phone ?? undefined,
    }),
    filter: activeOnly ? (q) => q.eq("status", "active") : undefined,
    scope: ["drivers", activeOnly],
  });
}

export function useProductPicker(
  selectedId: string,
  opts: { activeOnly?: boolean } = {},
): Picker {
  const { activeOnly = true } = opts;
  return useEntityPicker<Product>({
    table: "products",
    selectedId,
    searchColumns: ["name", "sku", "description"],
    orderBy: "name",
    toOption: (p) => ({ value: p.id, label: p.name, meta: p.sku ?? undefined }),
    filter: activeOnly ? (q) => q.eq("active", true) : undefined,
    scope: ["products", activeOnly],
  });
}

export function useDevicePicker(
  selectedId: string,
  opts: { inStockOnly?: boolean } = {},
): Picker {
  const { inStockOnly = false } = opts;
  return useEntityPicker<SlDevice>({
    table: "sl_devices",
    selectedId,
    searchColumns: ["serial", "imei", "model", "manufacturer"],
    orderBy: "serial",
    toOption: (d) => ({ value: d.id, label: d.serial, meta: d.model ?? undefined }),
    filter: inStockOnly ? (q) => q.eq("status", "in_stock") : undefined,
    scope: ["sl_devices", inStockOnly],
  });
}

export function useTechnicianPicker(
  selectedId: string,
  opts: { activeOnly?: boolean } = {},
): Picker {
  const { activeOnly = true } = opts;
  return useEntityPicker<SlTechnician>({
    table: "sl_technicians",
    selectedId,
    searchColumns: ["name", "phone", "email"],
    orderBy: "name",
    toOption: (tech) => ({ value: tech.id, label: tech.name, meta: tech.phone ?? undefined }),
    filter: activeOnly ? (q) => q.eq("active", true) : undefined,
    scope: ["sl_technicians", activeOnly],
  });
}

/**
 * Quotes, orders and invoices share a shape, so one hook covers all three.
 * They are ordered newest-first: the document someone is linking to was
 * almost always raised recently.
 */
export function useDocumentPicker(
  table: Extract<TableName, "quotes" | "sales_orders" | "invoices">,
  selectedId: string,
  opts: { customerId?: string | null; dateColumn?: string } = {},
): Picker {
  const { customerId, dateColumn = "issue_date" } = opts;
  return useEntityPicker<{ id: string; doc_number: string; title: string | null }>({
    table,
    selectedId,
    searchColumns: ["doc_number", "title", "customer_reference"],
    orderBy: dateColumn,
    ascending: false,
    toOption: (d) => ({ value: d.id, label: d.doc_number, meta: d.title ?? undefined }),
    filter: customerId ? (q) => q.eq("customer_id", customerId) : undefined,
    scope: [table, customerId],
  });
}
