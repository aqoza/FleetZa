import type { ActivityType, LeadSource, LeadStatus, Stage } from "../../../shared/crm";

export interface Person {
  full_name: string;
  email: string;
}

export interface Lead {
  id: string;
  number: number | null;
  doc_number: string | null;
  name: string;
  company_name: string | null;
  email: string | null;
  phone: string | null;
  source: LeadSource;
  status: LeadStatus;
  owner_id: string | null;
  estimated_value: number | null;
  currency: string;
  fleet_size: number | null;
  interest: string | null;
  notes: string | null;
  converted_customer_id: string | null;
  converted_opportunity_id: string | null;
  converted_at: string | null;
  created_at: string;
  owner: Person | null;
}

export const LEAD_SELECT =
  "id, number, doc_number, name, company_name, email, phone, source, status, owner_id, estimated_value, currency, " +
  "fleet_size, interest, notes, converted_customer_id, converted_opportunity_id, converted_at, created_at, " +
  "owner:profiles!crm_leads_owner_id_fkey(full_name, email)";

export interface Opportunity {
  id: string;
  number: number | null;
  doc_number: string | null;
  title: string;
  customer_id: string | null;
  lead_id: string | null;
  stage: Stage;
  amount: number;
  currency: string;
  probability: number;
  expected_close_date: string | null;
  owner_id: string | null;
  lost_reason: string | null;
  quote_id: string | null;
  won_at: string | null;
  lost_at: string | null;
  notes: string | null;
  created_at: string;
  customer: { name: string } | null;
  lead: { doc_number: string | null; name: string } | null;
  owner: Person | null;
}

export const OPP_SELECT =
  "id, number, doc_number, title, customer_id, lead_id, stage, amount, currency, probability, expected_close_date, owner_id, " +
  "lost_reason, quote_id, won_at, lost_at, notes, created_at, " +
  "customer:customers!crm_opportunities_customer_id_fkey(name), " +
  "lead:crm_leads!crm_opportunities_lead_id_fkey(doc_number, name), " +
  "owner:profiles!crm_opportunities_owner_id_fkey(full_name, email)";

export interface Activity {
  id: string;
  activity_type: ActivityType;
  subject: string;
  body: string | null;
  due_at: string | null;
  done_at: string | null;
  owner_id: string | null;
  lead_id: string | null;
  opportunity_id: string | null;
  customer_id: string | null;
  created_at: string;
  owner: Person | null;
  lead: { doc_number: string | null; name: string } | null;
  opportunity: { doc_number: string | null; title: string } | null;
  customer: { name: string } | null;
}

export const ACTIVITY_SELECT =
  "id, activity_type, subject, body, due_at, done_at, owner_id, lead_id, opportunity_id, customer_id, created_at, " +
  "owner:profiles!crm_activities_owner_id_fkey(full_name, email), " +
  "lead:crm_leads!crm_activities_lead_id_fkey(doc_number, name), " +
  "opportunity:crm_opportunities!crm_activities_opportunity_id_fkey(doc_number, title), " +
  "customer:customers!crm_activities_customer_id_fkey(name)";
