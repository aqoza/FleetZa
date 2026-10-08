import { bdiText, ltrText } from "../../lib/bidi";
import { formatDate, formatDateTime } from "../../lib/format";
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
      case "dispatch.urgent_job": {
        const end = strParam(p, "window_end");
        return {
          title: t("notifications.msg.urgentJob.title", { number: ltrText(strParam(p, "doc_number")), title: bdiText(strParam(p, "title")) }),
          body: end ? t("notifications.msg.urgentJob.body", { time: ltrText(formatDateTime(end)) }) : null,
        };
      }
      default:
        // Stored text is English: isolate it so it reads correctly inside Arabic UI.
        return { title: bdiText(n.title), body: n.body ? bdiText(n.body) : null };
    }
  };
}
