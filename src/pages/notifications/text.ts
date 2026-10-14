import { INCIDENT_TYPES, type IncidentType } from "../../../shared/incidents";
import { bdiText, ltrText } from "../../lib/bidi";
import { formatDate, formatDateTime, formatMoney } from "../../lib/format";
import { numParam, strParam } from "../../lib/notifications";
import { useT, useTp, type MessageKey } from "../../i18n";
import type { NotificationRow } from "./types";

const EMPLOYEE_DOCS: Record<string, MessageKey> = {
  passport: "notifications.doc.passport",
  residence_permit: "notifications.doc.residence_permit",
  work_permit: "notifications.doc.work_permit",
};

/**
 * Title + body in the UI language for the kinds the SPA knows; anything else
 * shows the English text app.notify stored with the row.
 */
export function useNotificationText() {
  const t = useT();
  const tp = useTp();
  return (n: Pick<NotificationRow, "kind" | "params" | "title" | "body">): { title: string; body: string | null } => {
    const p = n.params;
    switch (n.kind) {
      case "inventory.low_stock":
        return {
          title: t("notifications.msg.lowStock.title", { name: bdiText(strParam(p, "name")) }),
          body: t("notifications.msg.lowStock.body", {
            qty: ltrText(`${strParam(p, "on_hand")} ${strParam(p, "uom")}`),
            point: ltrText(strParam(p, "reorder_point")),
          }),
        };
      case "employees.document_expiring": {
        const days = numParam(p, "days") ?? 0;
        const docKey = EMPLOYEE_DOCS[strParam(p, "document")];
        const vars = { employee: bdiText(strParam(p, "employee")), document: docKey ? t(docKey) : strParam(p, "document") };
        const title =
          strParam(p, "stage") === "expired" || days < 0
            ? t("notifications.msg.employeeDoc.expired", vars)
            : days === 0
              ? t("notifications.msg.employeeDoc.today", vars)
              : tp("notifications.msg.employeeDoc.expiresIn", days, vars);
        const expiry = strParam(p, "expiry");
        return { title, body: expiry ? t("notifications.msg.expiryDate", { date: ltrText(formatDate(expiry)) }) : null };
      }
      case "hr.leave_requested": {
        const vars = { employee: bdiText(strParam(p, "employee")), type: bdiText(strParam(p, "type")) };
        return {
          title: tp("notifications.msg.leaveRequested", numParam(p, "days") ?? 0, vars),
          body: t("notifications.msg.leaveDates", {
            start: ltrText(formatDate(strParam(p, "start"))),
            end: ltrText(formatDate(strParam(p, "end"))),
          }),
        };
      }
      case "hr.leave_decided": {
        const vars = { type: bdiText(strParam(p, "type")) };
        return {
          title:
            strParam(p, "decision") === "approved"
              ? t("notifications.msg.leaveApproved", vars)
              : t("notifications.msg.leaveRejected", vars),
          body: t("notifications.msg.leaveDates", {
            start: ltrText(formatDate(strParam(p, "start"))),
            end: ltrText(formatDate(strParam(p, "end"))),
          }),
        };
      }
      case "documents.expiring": {
        const days = numParam(p, "days") ?? 0;
        const vars = { document: bdiText(strParam(p, "document")) };
        const title =
          strParam(p, "stage") === "expired" || days < 0
            ? t("notifications.msg.document.expired", vars)
            : days === 0
              ? t("notifications.msg.document.today", vars)
              : tp("notifications.msg.document.expiresIn", days, vars);
        const expiry = strParam(p, "expiry");
        return { title, body: expiry ? t("notifications.msg.expiryDate", { date: ltrText(formatDate(expiry)) }) : null };
      }
      case "automation.rule": {
        // The message is written by whoever set up the rule, not translated.
        const rule = strParam(p, "rule");
        return {
          title: bdiText(strParam(p, "message") || n.title),
          body: rule ? t("notifications.msg.automationRule.body", { rule: bdiText(rule) }) : null,
        };
      }
      case "integrations.webhook_failed": {
        const event = ltrText(strParam(p, "event"));
        const code = strParam(p, "code");
        const error = strParam(p, "error");
        return {
          title: t("notifications.msg.webhookFailed.title", { name: bdiText(strParam(p, "name")) }),
          body: code
            ? t("notifications.msg.webhookFailed.bodyCode", { event, code: ltrText(code) })
            : error
              ? t("notifications.msg.webhookFailed.bodyError", { event, error: bdiText(error) })
              : event,
        };
      }
      case "field.task_assigned": {
        const due = strParam(p, "due_at");
        return {
          title: t("notifications.msg.fieldAssigned.title", { title: bdiText(strParam(p, "title")) }),
          body: due ? t("notifications.msg.fieldDue", { date: ltrText(formatDateTime(due)) }) : null,
        };
      }
      case "field.task_overdue":
        return {
          title: t("notifications.msg.fieldOverdue.title", { title: bdiText(strParam(p, "title")) }),
          body: t("notifications.msg.fieldOverdue.body", {
            employee: bdiText(strParam(p, "employee")),
            date: ltrText(formatDateTime(strParam(p, "due_at"))),
          }),
        };
      case "purchasing.bill_due": {
        const days = numParam(p, "days") ?? 0;
        const vars = { number: ltrText(strParam(p, "number")), supplier: bdiText(strParam(p, "supplier")) };
        const title =
          strParam(p, "stage") === "overdue" || days < 0
            ? t("notifications.msg.billOverdue.title", vars)
            : days === 0
              ? t("notifications.msg.billDueToday.title", vars)
              : tp("notifications.msg.billDueIn.title", days, vars);
        const balance = numParam(p, "balance");
        const currency = strParam(p, "currency");
        return {
          title,
          body: balance != null && currency
            ? t("notifications.msg.billBalance", { amount: ltrText(formatMoney(balance, currency)) })
            : null,
        };
      }
      case "purchasing.po_late":
        return {
          title: t("notifications.msg.poLate.title", {
            number: ltrText(strParam(p, "number")),
            supplier: bdiText(strParam(p, "supplier")),
          }),
          body: t("notifications.msg.poLate.body", { date: ltrText(formatDate(strParam(p, "expected_date"))) }),
        };
      case "vendor_portal.po_acknowledged": {
        const expected = strParam(p, "expected_date");
        const note = strParam(p, "note");
        return {
          title: t("notifications.msg.poAcknowledged.title", {
            number: ltrText(strParam(p, "number")),
            supplier: bdiText(strParam(p, "supplier")),
          }),
          body: expected
            ? t("notifications.msg.poAcknowledged.expected", { date: ltrText(formatDate(expected)) })
            : note ? bdiText(note) : null,
        };
      }
      case "assets.warranty_expiring": {
        const days = numParam(p, "days") ?? 0;
        const asset = bdiText(strParam(p, "asset"));
        return {
          title:
            strParam(p, "stage") === "expired" || days < 0
              ? t("notifications.msg.warranty.expired", { asset })
              : days === 0
                ? t("notifications.msg.warranty.endsToday", { asset })
                : tp("notifications.msg.warranty.endsIn", days, { asset }),
          body: t("notifications.msg.warranty.body", { date: ltrText(formatDate(strParam(p, "expiry"))) }),
        };
      }
      case "gps.geofence_alert": {
        const vars = { vehicle: bdiText(strParam(p, "vehicle")), geofence: bdiText(strParam(p, "geofence")) };
        return {
          title: strParam(p, "event") === "exit"
            ? t("notifications.msg.geofence.exit", vars)
            : t("notifications.msg.geofence.enter", vars),
          body: t("notifications.msg.geofence.body", { at: ltrText(formatDateTime(strParam(p, "at"))) }),
        };
      }
      case "driver_behavior.critical_event": {
        const who = bdiText(strParam(p, "driver") || strParam(p, "vehicle"));
        return {
          title: strParam(p, "event_type") === "collision_warning"
            ? t("notifications.msg.drivingCritical.collision", { who })
            : t("notifications.msg.drivingCritical.fatigue", { who }),
          body: t("notifications.msg.drivingCritical.body", {
            vehicle: bdiText(strParam(p, "vehicle")),
            at: ltrText(formatDateTime(strParam(p, "at"))),
          }),
        };
      }
      case "iot.alert": {
        const unit = strParam(p, "unit");
        const value = `${strParam(p, "value")}${unit ? ` ${unit}` : ""}`;
        const op = ({ gt: ">", gte: "≥", lt: "<", lte: "≤", eq: "=" } as Record<string, string>)[strParam(p, "op")] ?? "";
        return {
          title: t("notifications.msg.iotAlert.title", {
            rule: bdiText(strParam(p, "rule")), device: bdiText(strParam(p, "device")),
          }),
          body: t("notifications.msg.iotAlert.body", {
            metric: ltrText(strParam(p, "metric")), value: ltrText(value), limit: ltrText(`${op} ${strParam(p, "threshold")}`),
          }),
        };
      }
      case "dispatch.urgent_job": {
        const end = strParam(p, "window_end");
        return {
          title: t("notifications.msg.urgentJob.title", { number: ltrText(strParam(p, "doc_number")), title: bdiText(strParam(p, "title")) }),
          body: end ? t("notifications.msg.urgentJob.body", { time: ltrText(formatDateTime(end)) }) : null,
        };
      }
      case "insurance.policy_expiring": {
        const days = numParam(p, "days") ?? 0;
        const policy = ltrText(strParam(p, "policy"));
        return {
          title:
            strParam(p, "stage") === "expired" || days < 0
              ? t("notifications.msg.policy.expired", { policy })
              : days === 0
                ? t("notifications.msg.policy.endsToday", { policy })
                : tp("notifications.msg.policy.endsIn", days, { policy }),
          body: t("notifications.msg.policy.body", {
            insurer: bdiText(strParam(p, "insurer")),
            date: ltrText(formatDate(strParam(p, "expiry"))),
          }),
        };
      }
      case "incidents.major": {
        const injuries = numParam(p, "injuries") ?? 0;
        const raw = strParam(p, "incident_type");
        const type = (INCIDENT_TYPES as readonly string[]).includes(raw) ? t(`incidents.type.${raw as IncidentType}`) : raw;
        const vars = { number: ltrText(strParam(p, "doc_number")), vehicle: bdiText(strParam(p, "vehicle")) };
        return {
          title: strParam(p, "severity") === "critical"
            ? t("notifications.msg.incident.critical", vars)
            : t("notifications.msg.incident.major", vars),
          body: injuries > 0 ? tp("notifications.msg.incident.bodyInjured", injuries, { type }) : t("notifications.msg.incident.body", { type }),
        };
      }
      default:
        // Stored text is English: isolate it so it reads correctly inside Arabic UI.
        return { title: bdiText(n.title), body: n.body ? bdiText(n.body) : null };
    }
  };
}
