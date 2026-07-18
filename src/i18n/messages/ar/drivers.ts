import { enDrivers } from "../en/drivers";

// Arabic (MSA). Glossary: سائق (driver), مركبة (vehicle), رخصة (license).
export const arDrivers: Record<keyof typeof enDrivers, string> = {
  // Page
  "drivers.title": "السائقون",
  "drivers.countDrivers": "{count} سائق",
  "drivers.searchPlaceholder": "ابحث عن السائقين…",

  // Actions / modals
  "drivers.addDriver": "إضافة سائق",
  "drivers.editDriver": "تعديل السائق",
  "drivers.deleteDriver": "حذف السائق",
  "drivers.editAria": "تعديل {name}",
  "drivers.deleteAria": "حذف {name}",
  "drivers.deleteConfirmBefore": "حذف",
  "drivers.deleteConfirmAfter": "؟ سيتم أيضًا إزالة سجل تعييناته.",
  "drivers.saveFailed": "فشل الحفظ",

  // Empty states
  "drivers.empty": "لا يوجد سائقون بعد",
  "drivers.noMatch": "لا يوجد سائقون مطابقون لبحثك",
  "drivers.emptyHint": "أضف السائقين لتتمكن من تعيين المركبات وتتبّع الرخص.",

  // Table headers
  "drivers.contact": "معلومات الاتصال",
  "drivers.license": "الرخصة",

  // Form fields
  "drivers.firstName": "الاسم الأول",
  "drivers.lastName": "اسم العائلة",
  "drivers.licenseNumber": "رقم الرخصة",
  "drivers.licenseClass": "فئة الرخصة",
  "drivers.licenseExpiry": "تاريخ انتهاء الرخصة",
  "drivers.hireDate": "تاريخ التعيين",

  // License-expiry badges
  "drivers.licenseExpired": "انتهت في {date}",
  "drivers.licenseExpires": "تنتهي في {date}",
};
