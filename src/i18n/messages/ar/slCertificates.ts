import { enSlCertificates } from "../en/slCertificates";

// Arabic (MSA). Glossary: شهادة (certificate), محدد السرعة (speed limiter),
// عميل (customer), جهاز (device), الرقم التسلسلي (serial),
// جهة الإصدار (issuing authority), السرعة المضبوطة (set speed),
// تجديد (renew), سحب (revoke).
export const arSlCertificates: Record<keyof typeof enSlCertificates, string> = {
  // List page
  "slCertificates.title": "الشهادات",
  "slCertificates.description": "شهادات مطابقة محددات السرعة الصادرة لعملائك",
  "slCertificates.settings": "إعدادات الشهادات",
  "slCertificates.searchPlaceholder": "ابحث برقم الشهادة…",

  // Filter chips
  "slCertificates.filterAll": "الكل",
  "slCertificates.filterValid": "سارية",
  "slCertificates.filter30": "خلال 30 يومًا",
  "slCertificates.filter60": "31–60 يومًا",
  "slCertificates.filter90": "61–90 يومًا",
  "slCertificates.filterExpired": "منتهية الصلاحية",
  "slCertificates.filterRevoked": "مسحوبة",

  // Table
  "slCertificates.number": "رقم الشهادة",
  "slCertificates.customer": "العميل",
  "slCertificates.vehicle": "المركبة",
  "slCertificates.issued": "تاريخ الإصدار",
  "slCertificates.expires": "تاريخ الانتهاء",
  "slCertificates.expiresInDays": "تنتهي خلال {count} يوم",

  // Row actions
  "slCertificates.print": "طباعة",
  "slCertificates.copyVerifyLink": "نسخ رابط التحقق",
  "slCertificates.linkCopied": "تم نسخ الرابط",
  "slCertificates.renew": "تجديد",
  "slCertificates.revoke": "سحب",

  // Renew modal
  "slCertificates.renewTitle": "تجديد الشهادة",
  "slCertificates.renewLead": "إصدار شهادة جديدة بدلًا من الشهادة {number}.",
  "slCertificates.renewNumberHint":
    "يُعيَّن رقم الشهادة الجديدة تلقائيًا عند الإصدار.",
  "slCertificates.issuingAuthority": "جهة الإصدار",
  "slCertificates.setSpeed": "السرعة المضبوطة (كم/س)",
  "slCertificates.issuedAt": "تاريخ الإصدار",
  "slCertificates.expiresAt": "تاريخ الانتهاء",
  "slCertificates.renewConfirm": "إصدار الشهادة",
  "slCertificates.renewFailed": "فشل التجديد",

  // Revoke modal
  "slCertificates.revokeTitle": "سحب الشهادة",
  "slCertificates.revokeLead":
    "سيتم وضع علامة \"مسحوبة\" على الشهادة {number}، وستظهر حالتها كمسحوبة في صفحة التحقق العامة.",
  "slCertificates.revokeReason": "السبب",
  "slCertificates.revokeConfirm": "سحب الشهادة",
  "slCertificates.revokeFailed": "فشل سحب الشهادة",

  // Delete modal
  "slCertificates.deleteTitle": "حذف الشهادة",
  "slCertificates.deleteConfirm":
    "هل تريد حذف الشهادة {number}؟ لا يمكن التراجع عن هذا الإجراء.",
  "slCertificates.deleteFailed": "فشل الحذف",

  // Settings modal
  "slCertificates.settingsTitle": "إعدادات الشهادات",
  "slCertificates.certPrefix": "بادئة رقم الشهادة",
  "slCertificates.certPrefixHint":
    "تُستخدم عند إنشاء أرقام الشهادات الجديدة، مثل SLC.",
  "slCertificates.validityMonths": "مدة الصلاحية (بالأشهر)",
  "slCertificates.validityHint":
    "مدة الصلاحية الافتراضية للشهادات الجديدة والمجدَّدة.",
  "slCertificates.settingsSaveFailed": "فشل حفظ الإعدادات",

  // Empty states
  "slCertificates.emptyTitle": "لا توجد شهادات بعد",
  "slCertificates.emptyDesc": "تُصدر الشهادات من المهام المكتملة وستظهر هنا.",
  "slCertificates.emptyFilteredTitle": "لا توجد شهادات مطابقة",
  "slCertificates.emptyFilteredDesc": "جرّب تغيير عامل التصفية أو كلمة البحث.",

  // Print page
  "slCertificates.printTitle": "شهادة مطابقة محدد السرعة",
  "slCertificates.certNumberLabel": "رقم الشهادة",
  "slCertificates.fieldCustomer": "العميل",
  "slCertificates.fieldVehicle": "المركبة",
  "slCertificates.fieldPlate": "رقم اللوحة",
  "slCertificates.fieldChassis": "رقم الهيكل",
  "slCertificates.fieldDeviceSerial": "الرقم التسلسلي للجهاز",
  "slCertificates.fieldSetSpeed": "السرعة المضبوطة",
  "slCertificates.fieldIssued": "تاريخ الإصدار",
  "slCertificates.fieldExpires": "تاريخ الانتهاء",
  "slCertificates.fieldAuthority": "جهة الإصدار",
  "slCertificates.scanToVerify": "امسح الرمز للتحقق",
  "slCertificates.authorizedSignature": "التوقيع المعتمد",
  "slCertificates.companyStamp": "ختم الشركة",
  "slCertificates.revokedBanner": "شهادة مسحوبة",
  "slCertificates.revokedOn": "سُحبت بتاريخ {date}",
  "slCertificates.generatedBy": "أُنشئت بواسطة FleetManage",
  "slCertificates.verifyAt": "رابط التحقق:",
  "slCertificates.notFound": "الشهادة غير موجودة",

  "slCertificates.report.typeInstallation": "تركيب",
  "slCertificates.report.typeRenewal": "تجديد",
  "slCertificates.report.countryOfInstallation": "بلد التركيب",
  "slCertificates.report.declarationTitle": "إقرار",
  "slCertificates.report.declarationText":
    "نشهد بأن المركبة الموضحة بياناتها أدناه قد جُهّزت بجهاز محدد سرعة الطريق، مبرمجًا على سرعة قصوى لا تتجاوز {speed}. ويتوافق محدد السرعة المركّب في المركبة مع المواصفة المعتمدة، والجهاز معايَر ومختوم.",
  "slCertificates.report.vehicleDetails": "بيانات المركبة",
  "slCertificates.report.vehicleOwner": "مالك المركبة",
  "slCertificates.report.registrationNo": "رقم التسجيل",
  "slCertificates.report.chassisNo": "رقم الهيكل",
  "slCertificates.report.engineNo": "رقم المحرك",
  "slCertificates.report.makeOfVehicle": "صنع المركبة",
  "slCertificates.report.modelOfVehicle": "طراز المركبة",
  "slCertificates.report.yearOfManufacture": "سنة الصنع",
  "slCertificates.report.slDetails": "بيانات محدد السرعة",
  "slCertificates.report.limiterType": "نوع محدد السرعة",
  "slCertificates.report.defaultLimiterType": "دواسة إلكترونية",
  "slCertificates.report.setSpeedLimit": "حد السرعة المضبوط",
  "slCertificates.report.serialNo": "الرقم التسلسلي",
  "slCertificates.report.tamperSealNo": "رقم ختم الحماية",
  "slCertificates.report.dateOfInstallation": "تاريخ التركيب",
  "slCertificates.report.technicianName": "اسم الفني",
  "slCertificates.report.dealerDetails": "بيانات الوكيل",
  "slCertificates.report.dealerName": "اسم الوكيل",
  "slCertificates.report.addressPhone": "العنوان والهاتف",
  "slCertificates.report.uinLabel": "الرقم التعريفي الفريد (UIN)",
  "slCertificates.report.validUpto": "صالحة حتى",
  "slCertificates.report.kmphPair": "{value}/{value} كم/س",
};
