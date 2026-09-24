import { enInspections } from "../en/inspections";
import type { Translation } from "../../plural";

// Arabic (MSA). Glossary: الفحص (inspection), مركبة (vehicle), سائق (driver),
// عطل (issue), عداد المسافة (odometer), الأولوية (priority), ملاحظات (notes).
export const arInspections: Translation<typeof enInspections, "ar"> = {
  "inspections.title": "الفحوصات",
  "inspections.new": "فحص جديد",
  "inspections.countRecorded": {
    zero: "لا توجد فحوصات مسجّلة",
    one: "فحص واحد مسجّل",
    two: "فحصان مسجّلان",
    few: "{count} فحوصات مسجّلة",
    many: "{count} فحصًا مسجّلًا",
    other: "{count} فحص مسجّل",
  },
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
  "inspections.failedItemsWarning": {
    zero: "لا توجد عناصر راسبة",
    one: "عنصر راسب واحد — سيتم إنشاء عطل بأولوية عالية",
    two: "عنصران راسبان — سيتم إنشاء عطلين بأولوية عالية",
    few: "{count} عناصر راسبة — سيتم إنشاء أعطال بأولوية عالية",
    many: "{count} عنصرًا راسبًا — سيتم إنشاء أعطال بأولوية عالية",
    other: "{count} عنصر راسب — سيتم إنشاء أعطال بأولوية عالية",
  },
  "inspections.save": "حفظ الفحص",
  "inspections.selectVehicleError": "اختر مركبة.",
  "inspections.saveFailed": "فشل الحفظ",
};
