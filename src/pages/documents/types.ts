import type { Tables } from "../../lib/database.types";

export type DocCategory =
  | "general" | "contract" | "invoice" | "receipt" | "photo" | "license"
  | "insurance" | "permit" | "report" | "certificate" | "other";

export const DOC_CATEGORIES: DocCategory[] = [
  "general", "contract", "invoice", "receipt", "photo", "license",
  "insurance", "permit", "report", "certificate", "other",
];

export type DocumentRow = Omit<Tables<"documents">, "category"> & { category: DocCategory };

/** Record types a document can be attached to from this module. */
export type LinkType = "vehicle" | "driver" | "customer" | "supplier" | "employee" | "incident";
