import { enInspections } from "../en/inspections";

// Arabic (MSA). Glossary: الفحص (inspection), مركبة (vehicle), سائق (driver),
// عطل (issue), عداد المسافة (odometer), الأولوية (priority), ملاحظات (notes).
export const arInspections: Record<keyof typeof enInspections, string> = {
  "inspections.title": "الفحوصات",
  "inspections.new": "فحص جديد",
  "inspections.countRecorded": "{count} فحوصات مسجّلة",
  "inspections.emptyTitle": "لا توجد فحوصات بعد",
  "inspections.emptyDescription":
    "أجرِ أول فحص لتسجيل حالة المركبة واكتشاف المشكلات مبكرًا.",

  // Table + details
  "inspections.result": "النتيجة",
  "inspections.failedItems": "العناصر الراسبة",
  "inspections.viewDetailsAria": "عرض تفاصيل الفحص للمركبة {vehicle}، {date}",
  "inspections.unknownVehicle": "مركبة غير معروفة",
  "inspections.detailsTitle": "تفاصيل الفحص",

  // Result values (Pass / Fail / N/A toggles + badges)
  "inspections.resultPass": "ناجح",
  "inspections.resultFail": "راسب",
  "inspections.resultNa": "غير منطبق",

  // New inspection form
  "inspections.newDescription": "راجع قائمة التحقق وسجّل حالة المركبة.",
  "inspections.onlyManagers": "يمكن للمشرفين فقط تسجيل الفحوصات.",
  "inspections.selectVehicle": "اختر مركبة…",
  "inspections.template": "القالب",
  "inspections.noDriver": "— بدون سائق —",
  "inspections.checklist": "قائمة التحقق",
  "inspections.generalSection": "عام",
  "inspections.failedInspectionTitle": "{item} — رسب في الفحص",
  "inspections.noTemplate":
    "لا يوجد قالب فحص نشط يحتوي على عناصر. لا يزال بإمكانك تسجيل ملاحظات عامة.",
  "inspections.whatsWrong": "ما المشكلة؟ (اختياري)",
  "inspections.generalNotes": "ملاحظات عامة",
  "inspections.failedItemWarning": "{count} عنصر راسب — سيتم إنشاء أعطال ذات أولوية عالية",
  "inspections.failedItemsWarning": "{count} عناصر راسبة — سيتم إنشاء أعطال ذات أولوية عالية",
  "inspections.save": "حفظ الفحص",
  "inspections.selectVehicleError": "اختر مركبة.",
  "inspections.saveFailed": "فشل الحفظ",
};
