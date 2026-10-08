import type { BadgeTone } from "../../components/ui";
import type { MessageKey } from "../../i18n";
import type { DocumentBucket, EmployeeDocumentKind } from "../../lib/employees";
import type { EmployeeStatus, EmploymentType, Gender } from "./types";

export const employeeStatus: Record<EmployeeStatus, { labelKey: MessageKey; tone: BadgeTone }> = {
  active: { labelKey: "employees.status.active", tone: "green" },
  on_leave: { labelKey: "employees.status.on_leave", tone: "blue" },
  suspended: { labelKey: "employees.status.suspended", tone: "yellow" },
  terminated: { labelKey: "employees.status.terminated", tone: "slate" },
};

export const employmentTypes: Record<EmploymentType, MessageKey> = {
  full_time: "employees.employmentType.full_time",
  part_time: "employees.employmentType.part_time",
  contract: "employees.employmentType.contract",
  temporary: "employees.employmentType.temporary",
  intern: "employees.employmentType.intern",
};

export const genders: Record<Gender, MessageKey> = {
  male: "employees.gender.male",
  female: "employees.gender.female",
};

export const documentKinds: Record<EmployeeDocumentKind, MessageKey> = {
  passport: "employees.doc.passport",
  residence_permit: "employees.doc.residence_permit",
  work_permit: "employees.doc.work_permit",
};

/** Red only for what needs action now; a far-off expiry is quiet. */
export const documentBucketMeta: Record<Exclude<DocumentBucket, "none">, { labelKey: MessageKey; tone: BadgeTone }> = {
  expired: { labelKey: "employees.docBucket.expired", tone: "red" },
  d7: { labelKey: "employees.docBucket.d7", tone: "red" },
  d30: { labelKey: "employees.docBucket.d30", tone: "yellow" },
  d60: { labelKey: "employees.docBucket.d60", tone: "blue" },
  ok: { labelKey: "employees.docBucket.ok", tone: "green" },
};
