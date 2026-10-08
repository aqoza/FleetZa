import { useEffect, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Pencil, UserRound } from "lucide-react";
import { getRow, listRows } from "../../lib/db";
import { recordRecent } from "../../lib/recent";
import { formatDate, formatMoney } from "../../lib/format";
import {
  employeeDocuments, employeeName, monthlyPackage, nextDocument, yearsOfService,
} from "../../lib/employees";
import type { Driver, Profile, SlTechnician } from "../../lib/types";
import { useAuth, useTenant } from "../../context/AuthContext";
import { useModules } from "../../context/ModulesContext";
import { useI18n, useT, useTp } from "../../i18n";
import {
  Badge, Bdi, Button, Card, EmptyState, ErrorState, LoadingState, Ltr, Modal, PageHeader,
} from "../../components/ui";
import { GratuityCard } from "../hr/GratuityCard";
import { EmployeeForm } from "./EmployeeForm";
import { DocumentBadge, todayIso } from "./shared";
import { documentKinds, employeeStatus, employmentTypes, genders } from "./labels";
import { EMPLOYEE_SELECT, type Employee, type EmployeeRow } from "./types";

function Kpi({ label, value }: { label: string; value: ReactNode }) {
  return (
    <Card className="p-4">
      <div className="text-xs font-medium text-ink-3">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-ink tabular-nums">{value}</div>
    </Card>
  );
}

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-5 gap-3 py-2 text-sm">
      <dt className="col-span-2 text-ink-3">{label}</dt>
      <dd className="col-span-3 min-w-0 break-words text-ink">{children}</dd>
    </div>
  );
}

function SectionCard({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <Card className={`p-5 ${className ?? ""}`}>
      <h3 className="mb-2 text-sm font-semibold text-ink">{title}</h3>
      <dl className="divide-y divide-line">{children}</dl>
    </Card>
  );
}

export default function EmployeeDetailPage() {
  const t = useT();
  const tp = useTp();
  const { language } = useI18n();
  const tenant = useTenant();
  const { employeeId = "" } = useParams();
  const { isManager } = useAuth();
  const { isEnabled } = useModules();
  const [editing, setEditing] = useState(false);
  const today = todayIso();
  const dash = t("common.dash");

  const { data: employee, isLoading, error } = useQuery({
    queryKey: ["employees", employeeId],
    queryFn: async () => {
      const rows = await listRows<EmployeeRow>("employees", (q) =>
        q.select(EMPLOYEE_SELECT).eq("id", employeeId).limit(1),
      );
      return rows[0] ?? null;
    },
  });

  useEffect(() => {
    if (employee) recordRecent(employeeName(employee), `/employees/${employee.id}`);
  }, [employee]);

  const managerQ = useQuery({
    queryKey: ["employees", employee?.manager_id],
    queryFn: () => getRow<Employee>("employees", employee!.manager_id!),
    enabled: !!employee?.manager_id,
  });

  const reportsQ = useQuery({
    queryKey: ["employees", "reports", employeeId],
    queryFn: () =>
      listRows<Employee>("employees", (q) =>
        q.eq("manager_id", employeeId).neq("status", "terminated").order("first_name"),
      ),
    enabled: isManager,
  });

  const userQ = useQuery({
    queryKey: ["profiles", employee?.user_id],
    queryFn: () => getRow<Profile>("profiles", employee!.user_id!),
    enabled: !!employee?.user_id,
  });
  const driverQ = useQuery({
    queryKey: ["drivers", employee?.driver_id],
    queryFn: () => getRow<Driver>("drivers", employee!.driver_id!),
    enabled: !!employee?.driver_id && isEnabled("drivers"),
  });
  const technicianQ = useQuery({
    queryKey: ["sl_technicians", employee?.sl_technician_id],
    queryFn: () => getRow<SlTechnician>("sl_technicians", employee!.sl_technician_id!),
    enabled: !!employee?.sl_technician_id && isEnabled("speed_limiters"),
  });

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState message={(error as Error).message} />;
  if (!employee) {
    return (
      <EmptyState
        icon={<UserRound className="h-10 w-10" />}
        title={t("employees.notFound")}
        action={
          <Link to="/employees" className="text-sm font-medium text-brand-700 hover:underline">
            {t("employees.title")}
          </Link>
        }
      />
    );
  }

  const st = employeeStatus[employee.status];
  const docs = employeeDocuments(employee, today);
  const next = nextDocument(employee, today);
  const years = yearsOfService(employee.hire_date, today, employee.termination_date);
  const pkg = monthlyPackage(employee);
  const money = (n: number | null) => (n == null ? dash : formatMoney(n, tenant.currency));
  const date = (d: string | null) => (d ? formatDate(d, tenant.timezone) : dash);
  const otherName = language === "ar" ? employeeName(employee) : employee.name_ar;
  const department = employee.department;

  return (
    <>
      <Link
        to="/employees"
        className="mb-4 inline-flex items-center gap-1 text-sm text-ink-3 hover:text-ink-2"
      >
        <ArrowLeft className="h-4 w-4 rtl:-scale-x-100" /> {t("employees.title")}
      </Link>
      <PageHeader
        title={employeeName(employee, language)}
        description={
          [employee.doc_number, employee.job_title, otherName !== employeeName(employee, language) ? otherName : null]
            .filter(Boolean)
            .join(" · ") || undefined
        }
        actions={
          <>
            <Badge tone={st.tone}>{t(st.labelKey)}</Badge>
            {isManager && (
              <Button variant="secondary" onClick={() => setEditing(true)}>
                <Pencil className="h-4 w-4" /> {t("action.edit")}
              </Button>
            )}
          </>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi label={t("employees.kpiService")} value={years == null ? dash : tp("employees.serviceYears", years)} />
        {isManager && <Kpi label={t("employees.kpiPackage")} value={money(pkg)} />}
        {isManager && (
          <Kpi label={t("employees.kpiReports")} value={reportsQ.data ? reportsQ.data.length : dash} />
        )}
        <Kpi
          label={t("employees.kpiNextDoc")}
          value={
            next ? (
              <span className="text-base">
                <span className="block text-sm font-medium text-ink-2">{t(documentKinds[next.kind])}</span>
                <DocumentBadge doc={next} />
              </span>
            ) : (
              dash
            )
          }
        />
      </div>

      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <SectionCard title={t("employees.section.employment")}>
          <DetailRow label={t("employees.jobTitle")}>
            {employee.job_title ? <Bdi>{employee.job_title}</Bdi> : dash}
          </DetailRow>
          <DetailRow label={t("employees.department")}>
            {department ? (
              <Bdi>{language === "ar" && department.name_ar ? department.name_ar : department.name}</Bdi>
            ) : (
              dash
            )}
          </DetailRow>
          <DetailRow label={t("employees.manager")}>
            {managerQ.data ? (
              <Link to={`/employees/${managerQ.data.id}`} className="text-brand-700 hover:underline">
                <Bdi>{employeeName(managerQ.data, language)}</Bdi>
              </Link>
            ) : (
              dash
            )}
          </DetailRow>
          <DetailRow label={t("employees.employmentTypeLabel")}>{t(employmentTypes[employee.employment_type])}</DetailRow>
          <DetailRow label={t("employees.hireDate")}>{date(employee.hire_date)}</DetailRow>
          {employee.termination_date && (
            <DetailRow label={t("employees.terminationDate")}>{date(employee.termination_date)}</DetailRow>
          )}
        </SectionCard>

        <SectionCard title={t("employees.section.personal")}>
          <DetailRow label={t("employees.genderLabel")}>
            {employee.gender ? t(genders[employee.gender]) : dash}
          </DetailRow>
          <DetailRow label={t("employees.birthDate")}>{date(employee.birth_date)}</DetailRow>
          <DetailRow label={t("employees.nationality")}>
            {employee.nationality ? <Ltr>{employee.nationality}</Ltr> : dash}
          </DetailRow>
          <DetailRow label={t("employees.nationalId")}>
            {employee.national_id ? <Ltr>{employee.national_id}</Ltr> : dash}
          </DetailRow>
          <DetailRow label={t("field.email")}>
            {employee.email ? (
              <a href={`mailto:${employee.email}`} className="text-brand-700 hover:underline">
                <Ltr>{employee.email}</Ltr>
              </a>
            ) : (
              dash
            )}
          </DetailRow>
          <DetailRow label={t("field.phone")}>{employee.phone ? <Ltr>{employee.phone}</Ltr> : dash}</DetailRow>
          <DetailRow label={t("employees.address")}>
            {employee.address ? <Bdi>{employee.address}</Bdi> : dash}
          </DetailRow>
          <DetailRow label={t("employees.emergencyName")}>
            {employee.emergency_contact_name ? (
              <>
                <Bdi>{employee.emergency_contact_name}</Bdi>
                {employee.emergency_contact_phone && (
                  <div className="text-xs text-ink-3"><Ltr>{employee.emergency_contact_phone}</Ltr></div>
                )}
              </>
            ) : (
              dash
            )}
          </DetailRow>
        </SectionCard>

        <Card className="p-5">
          <h3 className="mb-2 text-sm font-semibold text-ink">{t("employees.section.documents")}</h3>
          <dl className="divide-y divide-line">
            <DetailRow label={t("employees.passportNumber")}>
              {employee.passport_number ? <Ltr>{employee.passport_number}</Ltr> : dash}
            </DetailRow>
            <DetailRow label={t("employees.residencePermitNumber")}>
              {employee.residence_permit_number ? <Ltr>{employee.residence_permit_number}</Ltr> : dash}
            </DetailRow>
          </dl>
          {docs.length === 0 ? (
            <p className="mt-3 text-sm text-ink-3">{t("employees.noDocuments")}</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {docs.map((d) => (
                <li key={d.kind} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-canvas px-3 py-2">
                  <div>
                    <div className="text-sm font-medium text-ink">{t(documentKinds[d.kind])}</div>
                    <div className="text-xs text-ink-3 tabular-nums">{date(d.expiry)}</div>
                  </div>
                  <DocumentBadge doc={d} />
                </li>
              ))}
            </ul>
          )}
        </Card>

        {isManager ? (
          <SectionCard title={t("employees.section.compensation")}>
            <DetailRow label={t("employees.basicSalary")}>
              <span className="tabular-nums">{money(employee.basic_salary)}</span>
            </DetailRow>
            <DetailRow label={t("employees.housingAllowance")}>
              <span className="tabular-nums">{money(employee.housing_allowance)}</span>
            </DetailRow>
            <DetailRow label={t("employees.transportAllowance")}>
              <span className="tabular-nums">{money(employee.transport_allowance)}</span>
            </DetailRow>
            <DetailRow label={t("employees.otherAllowance")}>
              <span className="tabular-nums">{money(employee.other_allowance)}</span>
            </DetailRow>
            <DetailRow label={t("employees.hourlyRate")}>
              <span className="tabular-nums">{money(employee.hourly_rate)}</span>
            </DetailRow>
            <DetailRow label={t("employees.bankName")}>
              {employee.bank_name ? <Bdi>{employee.bank_name}</Bdi> : dash}
            </DetailRow>
            <DetailRow label={t("employees.iban")}>
              {employee.iban ? (
                <Ltr className="font-mono tabular-nums">{employee.iban.replace(/(.{4})(?=.)/g, "$1 ")}</Ltr>
              ) : (
                dash
              )}
            </DetailRow>
            <DetailRow label={t("employees.socialInsurance")}>
              {employee.social_insurance_number ? <Ltr>{employee.social_insurance_number}</Ltr> : dash}
            </DetailRow>
          </SectionCard>
        ) : (
          <Card className="p-5">
            <h3 className="mb-2 text-sm font-semibold text-ink">{t("employees.section.compensation")}</h3>
            <p className="text-sm text-ink-3">{t("employees.compensationHidden")}</p>
          </Card>
        )}

        {isManager && isEnabled("payroll_hr") && (
          <GratuityCard
            hireDate={employee.hire_date}
            terminationDate={employee.termination_date}
            basicSalary={employee.basic_salary}
            housingAllowance={employee.housing_allowance}
          />
        )}

        <SectionCard title={t("employees.section.links")}>
          <DetailRow label={t("employees.linkedUser")}>
            {userQ.data ? (
              <>
                <Bdi>{userQ.data.full_name || userQ.data.email}</Bdi>
                <div className="text-xs text-ink-3"><Ltr>{userQ.data.email}</Ltr></div>
              </>
            ) : (
              t("employees.noLink")
            )}
          </DetailRow>
          {isEnabled("drivers") && (
            <DetailRow label={t("employees.linkedDriver")}>
              {driverQ.data ? (
                <Bdi>{`${driverQ.data.first_name} ${driverQ.data.last_name}`}</Bdi>
              ) : (
                t("employees.noLink")
              )}
            </DetailRow>
          )}
          {isEnabled("speed_limiters") && (
            <DetailRow label={t("employees.linkedTechnician")}>
              {technicianQ.data ? <Bdi>{technicianQ.data.name}</Bdi> : t("employees.noLink")}
            </DetailRow>
          )}
          {employee.notes && (
            <DetailRow label={t("field.notes")}>
              <span className="whitespace-pre-line" dir="auto">{employee.notes}</span>
            </DetailRow>
          )}
        </SectionCard>

        {isManager && (
          <Card className="p-5">
            <h3 className="mb-2 text-sm font-semibold text-ink">{t("employees.directReports")}</h3>
            {reportsQ.isLoading ? (
              <LoadingState />
            ) : (reportsQ.data ?? []).length === 0 ? (
              <p className="text-sm text-ink-3">{t("employees.noReports")}</p>
            ) : (
              <ul className="divide-y divide-line">
                {(reportsQ.data ?? []).map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-3 py-2">
                    <Link to={`/employees/${r.id}`} className="text-sm font-medium text-brand-700 hover:underline">
                      <Bdi>{employeeName(r, language)}</Bdi>
                    </Link>
                    <span className="truncate text-xs text-ink-3">{r.job_title ? <Bdi>{r.job_title}</Bdi> : null}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}
      </div>

      <Modal title={t("employees.editEmployee")} open={editing} onClose={() => setEditing(false)} wide>
        <EmployeeForm employee={employee} onDone={() => setEditing(false)} onCancel={() => setEditing(false)} />
      </Modal>
    </>
  );
}
