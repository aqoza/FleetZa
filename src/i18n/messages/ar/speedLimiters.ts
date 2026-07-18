import { enSpeedLimiters } from "../en/speedLimiters";

// Arabic (MSA). Glossary: محدد السرعة (speed limiter), شهادة (certificate),
// تركيب (installation), الجهاز (device), الرقم التسلسلي (serial),
// السرعة المضبوطة (set speed), جهة الإصدار (issuing authority),
// تاريخ الإصدار (issue date), تاريخ الانتهاء (expiry date), تجديد (renew).
export const arSpeedLimiters: Record<keyof typeof enSpeedLimiters, string> = {
  "speedLimiters.title": "محددات السرعة",
  "speedLimiters.subtitle": "تركيبات محددات السرعة وشهاداتها في أسطولك",

  // Tabs
  "speedLimiters.tabInstallations": "التركيبات",
  "speedLimiters.tabCertificates": "الشهادات",

  // KPIs
  "speedLimiters.kpiActiveInstallations": "التركيبات الفعّالة",
  "speedLimiters.kpiVehiclesCovered": "المركبات المشمولة",

  // Installations table
  "speedLimiters.device": "الجهاز",
  "speedLimiters.setSpeed": "السرعة المضبوطة",
  "speedLimiters.kmhValue": "{value} كم/س",
  "speedLimiters.installed": "تاريخ التركيب",
  "speedLimiters.status.active": "فعّال",
  "speedLimiters.status.maintenance": "قيد الصيانة",
  "speedLimiters.status.removed": "مُزال",

  // Installation actions & form
  "speedLimiters.newInstallation": "تركيب جديد",
  "speedLimiters.editInstallation": "تعديل التركيب",
  "speedLimiters.deleteInstallation": "حذف التركيب",
  "speedLimiters.selectVehicle": "اختر مركبة…",
  "speedLimiters.deviceSerial": "الرقم التسلسلي للجهاز",
  "speedLimiters.brand": "العلامة التجارية",
  "speedLimiters.model": "الطراز",
  "speedLimiters.setSpeedKmh": "السرعة المضبوطة (كم/س)",
  "speedLimiters.installedAt": "تاريخ التركيب",
  "speedLimiters.technician": "الفنّي",
  "speedLimiters.deleteInstallationConfirm":
    "هل تريد حذف تركيب الجهاز {serial} على المركبة {vehicle}؟ لا يمكن التراجع عن هذا الإجراء.",

  // Installations empty state
  "speedLimiters.noInstallationsYet": "لا توجد تركيبات بعد",
  "speedLimiters.installationsEmptyDesc":
    "سجّل أجهزة محدد السرعة المركّبة في مركباتك لمتابعتها ومتابعة شهاداتها.",

  // Certificates table
  "speedLimiters.certificateNumber": "رقم الشهادة",
  "speedLimiters.issued": "تاريخ الإصدار",
  "speedLimiters.expires": "تاريخ الانتهاء",
  "speedLimiters.expired": "منتهية الصلاحية",
  "speedLimiters.expiresInDays": "تنتهي خلال {count} يوم",

  // Certificate actions & form
  "speedLimiters.newCertificate": "شهادة جديدة",
  "speedLimiters.editCertificate": "تعديل الشهادة",
  "speedLimiters.deleteCertificate": "حذف الشهادة",
  "speedLimiters.renewCertificate": "تجديد الشهادة",
  "speedLimiters.renew": "تجديد",
  "speedLimiters.installation": "التركيب",
  "speedLimiters.installationHint": "اختياري — اربط الشهادة بجهاز مركّب",
  "speedLimiters.noLinkedInstallation": "بدون تركيب مرتبط",
  "speedLimiters.issuingAuthority": "جهة الإصدار",
  "speedLimiters.issuedAt": "تاريخ الإصدار",
  "speedLimiters.expiresAt": "تاريخ الانتهاء",
  "speedLimiters.deleteCertificateConfirm":
    "هل تريد حذف الشهادة {number} الخاصة بالمركبة {vehicle}؟ لا يمكن التراجع عن هذا الإجراء.",

  // Certificates empty state
  "speedLimiters.noCertificatesYet": "لا توجد شهادات بعد",
  "speedLimiters.certificatesEmptyDesc":
    "تابع شهادات محدد السرعة حتى يتم تجديدها قبل انتهاء صلاحيتها.",

  // Errors
  "speedLimiters.saveFailed": "فشل الحفظ",
  "speedLimiters.deleteFailed": "فشل الحذف",
};
