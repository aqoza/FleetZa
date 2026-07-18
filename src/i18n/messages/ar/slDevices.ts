import { enSlDevices } from "../en/slDevices";

// سجل أجهزة محدد السرعة — الترجمة العربية الكاملة (النوع يفرض اكتمالها).
export const arSlDevices: Record<keyof typeof enSlDevices, string> = {
  "slDevices.title": "الأجهزة",
  "slDevices.description": "سجل أجهزة محدد السرعة — المخزون والتركيبات والضمان.",

  // شريط الأدوات
  "slDevices.searchPlaceholder": "ابحث بالرقم التسلسلي أو الشركة المصنّعة أو الطراز أو IMEI…",

  // الإجراءات
  "slDevices.addDevice": "إضافة جهاز",
  "slDevices.editDevice": "تعديل الجهاز",
  "slDevices.deleteDevice": "حذف الجهاز",
  "slDevices.history": "السجل",

  // الجدول
  "slDevices.serial": "الرقم التسلسلي",
  "slDevices.firmware": "البرنامج الثابت",
  "slDevices.imei": "IMEI",
  "slDevices.warranty": "الضمان",
  "slDevices.outOfWarranty": "خارج الضمان",
  "slDevices.warrantyDaysLeft": "متبقٍ {count} يومًا",

  // النموذج
  "slDevices.serialNumber": "الرقم التسلسلي",
  "slDevices.manufacturer": "الشركة المصنّعة",
  "slDevices.model": "الطراز",
  "slDevices.firmwareVersion": "إصدار البرنامج الثابت",
  "slDevices.purchaseDate": "تاريخ الشراء",
  "slDevices.purchasePrice": "سعر الشراء ({currency})",
  "slDevices.supplier": "المورّد",
  "slDevices.warrantyUntil": "الضمان حتى",
  "slDevices.duplicateSerial": "يوجد جهاز بهذا الرقم التسلسلي بالفعل.",

  // الحذف
  "slDevices.deleteConfirm": "هل تريد حذف الجهاز {serial}؟ لا يمكن التراجع عن هذا الإجراء.",
  "slDevices.deleteInstalledWarning":
    "هذا الجهاز مركّب حاليًا على مركبة. يُفضّل تسجيل مهمة إزالة قبل حذفه.",

  // نافذة السجل
  "slDevices.historyTitle": "سجل الجهاز — {serial}",
  "slDevices.jobNumber": "مهمة رقم {number}",
  "slDevices.historyEmptyTitle": "لا توجد مهام بعد",
  "slDevices.historyEmptyDesc": "لم يُستخدم هذا الجهاز في أي مهمة بعد.",

  // الحالات الفارغة
  "slDevices.emptyTitle": "لا توجد أجهزة بعد",
  "slDevices.emptyDesc": "سجّل أجهزة محدد السرعة لديك لتتبّع المخزون والتركيبات والضمانات.",
  "slDevices.emptyFilteredTitle": "لا توجد أجهزة مطابقة",
  "slDevices.emptyFilteredDesc": "جرّب تغيير البحث أو عامل تصفية الحالة.",

  // الأخطاء
  "slDevices.saveFailed": "فشل الحفظ",
  "slDevices.deleteFailed": "فشل الحذف",
};
