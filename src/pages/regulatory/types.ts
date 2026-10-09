import type { Category, ObligationStatus, SubjectType } from "../../../shared/regulatory";

export interface Requirement {
  id: string;
  code: string;
  title: string;
  title_ar: string | null;
  authority: string | null;
  country: string | null;
  category: Category;
  applies_to: SubjectType;
  frequency_months: number | null;
  lead_days: number;
  reference_url: string | null;
  description: string | null;
  verified: boolean;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export const REQ_SELECT =
  "id, code, title, title_ar, authority, country, category, applies_to, frequency_months, lead_days, reference_url, " +
  "description, verified, active, created_at, updated_at";

export interface Obligation {
  id: string;
  requirement_id: string;
  subject_type: SubjectType;
  subject_id: string | null;
  due_date: string;
  status: ObligationStatus;
  completed_on: string | null;
  evidence_document_id: string | null;
  responsible_user: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  requirement: Pick<Requirement, "code" | "title" | "title_ar" | "category" | "lead_days" | "frequency_months" | "active"> | null;
  responsible: { full_name: string; email: string } | null;
}

export const OBL_SELECT =
  "id, requirement_id, subject_type, subject_id, due_date, status, completed_on, evidence_document_id, responsible_user, notes, " +
  "created_at, updated_at, " +
  "requirement:compliance_requirements!compliance_obligations_requirement_id_fkey(code, title, title_ar, category, lead_days, frequency_months, active), " +
  "responsible:profiles!compliance_obligations_responsible_user_fkey(full_name, email)";
