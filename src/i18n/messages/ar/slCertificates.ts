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
  "slCertificates.searchPlaceholder": "رقم الشهادة أو UIN أو الختم أو المركبة أو اللوحة…",
  "slCertificates.searchNarrowHint":
    "أكثر من {count} مركبة تطابق هذا البحث، ولم تُدرَج سوى أول {count} منها. ضيّق نطاق البحث لعرض الباقي.",
  "slCertificates.searchSupersededHint":
    "توجد {count} شهادة مُستبدَلة مطابقة، وقد حلّ محلها تجديد لاحق، لذا لا تظهر هنا.",
  "slCertificates.searchSupersededLink": "عرضها",

  // Filter chips
  "slCertificates.filterAll": "الكل",
  "slCertificates.filterValid": "سارية",
  "slCertificates.filter30": "خلال 30 يومًا",
  "slCertificates.filter60": "31–60 يومًا",
  "slCertificates.filter90": "61–90 يومًا",
  "slCertificates.filterExpired": "منتهية الصلاحية",
  "slCertificates.filterRevoked": "مسحوبة",
  "slCertificates.filterSuperseded": "مُستبدَلة",

  // Table
  "slCertificates.number": "رقم الشهادة",
  "slCertificates.customer": "العميل",
  "slCertificates.vehicle": "المركبة",
  "slCertificates.issued": "تاريخ الإصدار",
  "slCertificates.expires": "تاريخ الانتهاء",
  "slCertificates.expiresInDays": "تنتهي خلال {count} يوم",

  // Row actions
  "slCertificates.print": "طباعة",
  "slCertificates.download": "تنزيل",
  "slCertificates.downloadFailed": "تعذّر إنشاء ملف PDF — حاول مرة أخرى",
  "slCertificates.copyVerifyLink": "نسخ رابط التحقق",
  "slCertificates.linkCopied": "تم نسخ الرابط",
  "slCertificates.renew": "تجديد",
  "slCertificates.renewBlockedRevoked": "لا يمكن تجديدها — هذه الشهادة مسحوبة",
  "slCertificates.renewBlockedSuperseded": "لا يمكن تجديدها — حلّت محلها شهادة أحدث بالفعل",
  "slCertificates.revoke": "سحب",

  // Renew modal
  "slCertificates.renewTitle": "تجديد الشهادة",
  "slCertificates.renewLead": "إصدار شهادة جديدة بدلًا من الشهادة {number}.",
  "slCertificates.renewNumberHint":
    "يُعيَّن رقم الشهادة الجديدة تلقائيًا عند الإصدار.",
  "slCertificates.issuingAuthority": "جهة الإصدار",
  "slCertificates.setSpeed": "السرعة المضبوطة (كم/س)",
  "slCertificates.setSpeedSecondary": "النطاق الثاني (كم/س)",
  "slCertificates.setSpeedSecondaryHint":
    "اختياري. تطبع الشهادات النطاقين معًا، مثل ٧٠/٩٠ كم/س.",
  "slCertificates.technician": "الفني",
  "slCertificates.technicianHint": "يُطبع على الشهادة. القيمة الافتراضية من إعدادات الشهادات.",
  "slCertificates.technicianNone": "— بدون —",
  "slCertificates.defaultTechnician": "الفني الافتراضي",
  "slCertificates.defaultTechnicianHint":
    "يُحدَّد مسبقًا عند إصدار الشهادة. يُنسخ الاسم إلى كل شهادة عند إصدارها، لذا لا يؤدي تغيير اسم الفني أو حذفه إلى تغيير شهادة صادرة.",
  "slCertificates.defaultTechnicianNone": "— بدون افتراضي —",
  "slCertificates.issuedAt": "تاريخ الإصدار",
  "slCertificates.expiresAt": "تاريخ الانتهاء",
  "slCertificates.renewConfirm": "إصدار الشهادة",
  "slCertificates.renewFailed": "فشل التجديد",
  "slCertificates.toast.issued": "تم إصدار الشهادة {number}.",
  "slCertificates.toast.renewed": "تم التجديد بالشهادة {number}.",
  "slCertificates.renewLoadFailed": "تعذّر تحميل هذه الشهادة، لذا لا يمكن تجديدها.",

  // Bulk renew
  "slCertificates.bulkRenew": "تجديد المحدد",
  "slCertificates.bulkRenewTitle": "تجديد {count} شهادة",
  "slCertificates.bulkRenewLead":
    "ستُصدَر شهادة بديلة لكل مركبة من المركبات الـ{count} أدناه، مع نقل جهة الإصدار والسرعات المضبوطة كما هي.",
  "slCertificates.bulkEligible": "سيتم تجديدها ({count})",
  "slCertificates.bulkSkipped": "تم تخطيها ({count})",
  "slCertificates.bulkSkipRevoked": "مسحوبة — لا يمكن تجديدها",
  "slCertificates.bulkSkipSuperseded": "جُدِّدت من قبل",
  "slCertificates.bulkNoneEligible": "لا يمكن تجديد أي من الشهادات المحددة.",
  "slCertificates.bulkProgress": "جارٍ إصدار {done} من {total}…",
  "slCertificates.bulkCloseBlocked":
    "جارٍ إصدار الشهادات — تبقى هذه النافذة مفتوحة حتى انتهاء العملية ليصلك التقرير كاملًا.",
  "slCertificates.bulkConfirm": "إصدار {count} شهادة",
  "slCertificates.bulkDoneAll": "تم إصدار {count} شهادة.",
  "slCertificates.bulkDonePartial":
    "تم إصدار {done} من {total} شهادة، وفشل {failed} منها — الشهادات أدناه لم تُجدَّد.",
  "slCertificates.bulkSucceeded": "تم إصدارها",
  "slCertificates.bulkFailed": "فشلت",

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
  "slCertificates.notFound": "الشهادة غير موجودة",

  "slCertificates.report.typeInstallation": "تركيب",
  "slCertificates.report.typeRenewal": "تجديد",
  "slCertificates.report.applicableStandard": "المواصفة المعتمدة",
  "slCertificates.report.certificateNo": "رقم الشهادة",
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
  "slCertificates.report.speedUnit": "كم/س",

  "slCertificates.report.footerCr": "س.ت: {value}",
  "slCertificates.report.footerPoBox": "ص.ب: {value}",
  "slCertificates.report.footerPostalCode": "الرمز البريدي: {value}",
  "slCertificates.report.footerWebsite": "الموقع الإلكتروني: {value}",
  "slCertificates.report.footerPhone": "نقال الخدمة والدعم: {value}",
  "slCertificates.report.footerPhoneSecondary": "نقال بديل: {value}",
  "slCertificates.report.footerSeparator": "، ",
  "slCertificates.report.footerEmail": "البريد الإلكتروني: {value}",
  "slCertificates.report.signature": "التوقيع المعتمد",
  "slCertificates.report.stamp": "ختم الشركة",
  "slCertificates.report.forCompany": "عن {name}",
};
