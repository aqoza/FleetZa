import { enRenewals } from "../en/renewals";
import type { Translation } from "../../plural";

// Arabic (MSA). Glossary: تجديد (renewal), تسجيل (registration), تأمين (insurance),
// مركبة (vehicle), تاريخ الاستحقاق (due date), متأخر (overdue).
export const arRenewals: Translation<typeof enRenewals, "ar"> = {
  "renewals.title": "التجديدات",
  "renewals.description": "التسجيلات والتأمين والتصاريح وغيرها من المستندات التي تنتهي صلاحيتها",

  // Actions
  "renewals.addRenewal": "إضافة تجديد",
  "renewals.addDefaults": "إضافة الإعدادات الافتراضية للدولة",
  "renewals.editRenewal": "تعديل التجديد",
  "renewals.deleteRenewal": "حذف التجديد",

  // Form fields
  "renewals.type": "النوع",
  "renewals.selectVehicle": "اختر مركبة…",
  "renewals.nameHint": "تسمية مخصصة اختيارية، مثل اسم شركة التأمين أو التصريح",
  "renewals.amountLabel": "المبلغ ({currency})",
  "renewals.recurEvery": "يتكرر كل (أشهر)",
  "renewals.recurHint": "اتركه فارغًا لمرة واحدة",

  // Table
  "renewals.recurs": "التكرار",
  "renewals.everyMonthsShort": {
    zero: "كل {count} شهر",
    one: "كل شهر",
    two: "كل شهرين",
    few: "كل {count} أشهر",
    many: "كل {count} شهرًا",
    other: "كل {count} شهر",
  },
  "renewals.overdue": "متأخر",
  "renewals.dueInDays": {
    zero: "اليوم",
    one: "خلال يوم واحد",
    two: "خلال يومين",
    few: "خلال {count} أيام",
    many: "خلال {count} يومًا",
    other: "خلال {count} يوم",
  },
  "renewals.statusPending": "قيد الانتظار",
  "renewals.statusCompleted": "مكتمل",
  "renewals.completedOn": "اكتمل في {date}",

  // Filters
  "renewals.allVehicles": "كل المركبات",

  // Empty states
  "renewals.emptyTitle": "لا توجد تجديدات بعد",
  "renewals.emptyDesc": "تابع التسجيلات والتأمين والتصاريح حتى لا تنتهي صلاحية أي منها دون أن تلاحظ.",
  "renewals.emptyFilteredTitle": "لا توجد تجديدات مطابقة لعوامل التصفية",
  "renewals.emptyFilteredDesc": "جرّب حالة أو مركبة مختلفة في التصفية.",

  // Country defaults modal
  "renewals.standardFor": "التجديدات القياسية لـ {country}",
  "renewals.everyMonthsLong": {
    zero: "كل {count} شهر",
    one: "كل شهر",
    two: "كل شهرين",
    few: "كل {count} أشهر",
    many: "كل {count} شهرًا",
    other: "كل {count} شهر",
  },
  "renewals.addedN": {
    zero: "لم تتم إضافة أي تجديد",
    one: "تمت إضافة تجديد واحد",
    two: "تمت إضافة تجديدين",
    few: "تمت إضافة {count} تجديدات",
    many: "تمت إضافة {count} تجديدًا",
    other: "تمت إضافة {count} تجديد",
  },
  "renewals.allExist": "جميع التجديدات القياسية موجودة بالفعل لهذه المركبة.",

  // Error messages
  "renewals.saveFailed": "فشل الحفظ",
  "renewals.addDefaultsFailed": "فشلت إضافة التجديدات",
  "renewals.completeFailed": "فشل تحديد التجديد كمكتمل",
  "renewals.deleteFailed": "فشل حذف التجديد",

  // Delete confirmation (name is rendered bold between the lead and rest)
  "renewals.deleteLead": "هل تريد حذف تجديد ",
  "renewals.deleteRestVehicle": " الخاص بالمركبة {vehicle}؟ لا يمكن التراجع عن هذا الإجراء.",
  "renewals.deleteRestNoVehicle": "؟ لا يمكن التراجع عن هذا الإجراء.",
};
