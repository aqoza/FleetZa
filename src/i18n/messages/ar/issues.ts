import { enIssues } from "../en/issues";

// Arabic (MSA). Glossary: عطل (issue), مركبة (vehicle), أمر عمل (work order),
// الفحص (inspection). The Record type enforces completeness.
export const arIssues: Record<keyof typeof enIssues, string> = {
  "issues.title": "الأعطال",
  "issues.reportedCount": "{count} عطل مُبلَّغ عنه",
  "issues.report": "الإبلاغ عن عطل",

  "issues.allVehicles": "جميع المركبات",

  "issues.selectVehicle": "اختر مركبة…",
  "issues.fieldTitle": "العنوان",
  "issues.fieldDescription": "الوصف",
  "issues.saveFailed": "فشل الحفظ",

  "issues.colIssue": "العطل",
  "issues.colReported": "تاريخ الإبلاغ",
  "issues.fromInspection": "من الفحص",
  "issues.workOrderLink": "أمر العمل ↗",

  "issues.start": "بدء",
  "issues.resolve": "حل",
  "issues.createWo": "إنشاء أمر عمل",
  "issues.deleteAria": "حذف {title}",
  "issues.updateFailed": "فشل تحديث العطل",
  "issues.createWoFailed": "فشل إنشاء أمر العمل",
  "issues.deleteFailed": "فشل حذف العطل",

  "issues.emptyTitle": "لا توجد أعطال مُبلَّغ عنها",
  "issues.emptyDesc": "أبلغ عن عطل عندما تحتاج مركبة إلى الاهتمام.",
  "issues.emptyFilteredTitle": "لا توجد أعطال مطابقة لعوامل التصفية",
  "issues.emptyFilteredDesc": "جرّب عامل تصفية مختلفًا للحالة أو المركبة.",

  "issues.deleteTitle": "حذف عطل",
  "issues.deleteConfirm": "هل تريد حذف",
  "issues.deleteConfirmUndone": "؟ لا يمكن التراجع عن هذا.",
};
