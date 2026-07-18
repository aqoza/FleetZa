import { enSpeedLimiters } from "../en/speedLimiters";

// Arabic (MSA). Glossary: محدد السرعة (speed limiter), عميل (customer),
// جهاز (device), فني (technician), مهمة (job), تركيب (installation),
// فحص (inspection), صيانة (maintenance), إزالة (removal), استبدال (replacement),
// طوارئ (emergency), شهادة (certificate), مراقبة الجودة (QC), المخزون (stock).
export const arSpeedLimiters: Record<keyof typeof enSpeedLimiters, string> = {
  // Hub
  "speedLimiters.title": "محددات السرعة",
  "speedLimiters.subtitle":
    "العملاء والأجهزة والمهام وشهادات المطابقة لخدمة محددات السرعة لديك",
  "speedLimiters.tab.overview": "نظرة عامة",
  "speedLimiters.tab.customers": "العملاء",
  "speedLimiters.tab.devices": "الأجهزة",
  "speedLimiters.tab.jobs": "المهام",
  "speedLimiters.tab.certificates": "الشهادات",

  // --- Shared enum labels (contract) ---
  "speedLimiters.jobType.installation": "تركيب",
  "speedLimiters.jobType.inspection": "فحص",
  "speedLimiters.jobType.maintenance": "صيانة",
  "speedLimiters.jobType.removal": "إزالة",
  "speedLimiters.jobType.replacement": "استبدال",
  "speedLimiters.jobType.emergency": "طوارئ",

  "speedLimiters.jobStatus.scheduled": "مجدولة",
  "speedLimiters.jobStatus.in_progress": "قيد التنفيذ",
  "speedLimiters.jobStatus.completed": "مكتملة",
  "speedLimiters.jobStatus.qc_approved": "معتمدة من مراقبة الجودة",
  "speedLimiters.jobStatus.closed": "مغلقة",
  "speedLimiters.jobStatus.canceled": "ملغاة",

  "speedLimiters.deviceStatus.in_stock": "في المخزون",
  "speedLimiters.deviceStatus.installed": "مركّب",
  "speedLimiters.deviceStatus.faulty": "معطّل",
  "speedLimiters.deviceStatus.retired": "مسحوب من الخدمة",

  "speedLimiters.certStatus.valid": "سارية",
  "speedLimiters.certStatus.expiring": "قاربت على الانتهاء",
  "speedLimiters.certStatus.expired": "منتهية الصلاحية",
  "speedLimiters.certStatus.revoked": "مسحوبة",

  "speedLimiters.kmhValue": "{value} كم/س",

  // --- Overview (command center) ---
  "speedLimiters.overview.kpiCustomers": "العملاء",
  "speedLimiters.overview.kpiDevicesInstalled": "الأجهزة المركّبة",
  "speedLimiters.overview.kpiInStock": "{count} في المخزون",
  "speedLimiters.overview.kpiOpenJobs": "المهام المفتوحة",
  "speedLimiters.overview.kpiValidCertificates": "الشهادات السارية",
  "speedLimiters.overview.expiryBoard": "لوحة انتهاء صلاحية الشهادات",
  "speedLimiters.overview.bucketExpired": "منتهية الصلاحية",
  "speedLimiters.overview.bucket30": "خلال 30 يومًا",
  "speedLimiters.overview.bucket60": "31–60 يومًا",
  "speedLimiters.overview.bucket90": "61–90 يومًا",
  "speedLimiters.overview.bucketEmpty": "لا توجد شهادات",
  "speedLimiters.overview.daysOverdue": "متأخرة {count} يوم",
  "speedLimiters.overview.inDays": "خلال {count} يوم",
  "speedLimiters.overview.viewAll": "عرض الكل",
  "speedLimiters.overview.recentJobs": "أحدث المهام",
  "speedLimiters.overview.jobNumber": "#{number}",
  "speedLimiters.overview.noJobs": "لا توجد مهام بعد",
  "speedLimiters.overview.noJobsDesc": "ستظهر هنا المهام التي تجدولها لعملائك.",

  // --- Public certificate verification page ---
  "speedLimiters.verify.title": "التحقق من الشهادة",
  "speedLimiters.verify.checking": "جارٍ التحقق من الشهادة…",
  "speedLimiters.verify.status.valid": "الشهادة سارية",
  "speedLimiters.verify.status.validDesc":
    "شهادة محدد السرعة هذه أصلية وسارية المفعول حاليًا.",
  "speedLimiters.verify.status.expired": "الشهادة منتهية الصلاحية",
  "speedLimiters.verify.status.expiredDesc":
    "هذه الشهادة موجودة لكن فترة صلاحيتها قد انتهت.",
  "speedLimiters.verify.status.revoked": "الشهادة مسحوبة",
  "speedLimiters.verify.status.revokedDesc":
    "تم سحب هذه الشهادة من قبل الجهة المصدرة ولم تعد صالحة.",
  "speedLimiters.verify.status.not_found": "الشهادة غير موجودة",
  "speedLimiters.verify.status.not_foundDesc":
    "لا توجد شهادة مطابقة لرمز التحقق هذا.",
  "speedLimiters.verify.noCode": "رابط التحقق لا يحتوي على رمز.",
  "speedLimiters.verify.error": "فشل التحقق. يرجى التأكد من الاتصال والمحاولة مرة أخرى.",
  "speedLimiters.verify.certificateNumber": "رقم الشهادة",
  "speedLimiters.verify.issuedBy": "صادرة عن",
  "speedLimiters.verify.customer": "العميل",
  "speedLimiters.verify.vehicle": "المركبة",
  "speedLimiters.verify.plate": "رقم اللوحة",
  "speedLimiters.verify.setSpeed": "السرعة المضبوطة",
  "speedLimiters.verify.issuedAt": "تاريخ الإصدار",
  "speedLimiters.verify.expiresAt": "تاريخ الانتهاء",
  "speedLimiters.verify.issuingAuthority": "جهة الإصدار",
  "speedLimiters.verify.poweredBy": "خدمة التحقق مقدَّمة من {app}",
};
