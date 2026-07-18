import { enSlCustomers } from "../en/slCustomers";

export const arSlCustomers: Record<keyof typeof enSlCustomers, string> = {
  // Page
  "slCustomers.title": "العملاء",
  "slCustomers.subtitle": "المنشآت العميلة التي تركّب لها محددات السرعة وتصدر شهاداتها",
  "slCustomers.newCustomer": "عميل جديد",
  "slCustomers.editCustomer": "تعديل العميل",
  "slCustomers.deleteCustomer": "حذف العميل",
  "slCustomers.searchPlaceholder": "ابحث بالاسم أو رقم السجل التجاري أو الهاتف أو البريد الإلكتروني…",
  "slCustomers.allStatuses": "كل الحالات",

  // Status
  "slCustomers.status.active": "نشط",
  "slCustomers.status.inactive": "غير نشط",

  // List table
  "slCustomers.company": "الشركة",
  "slCustomers.cityCountry": "المدينة / الدولة",
  "slCustomers.contact": "جهة الاتصال",
  "slCustomers.billingTerms": "شروط الفوترة",
  "slCustomers.creditLimit": "حد الائتمان",

  // Form fields
  "slCustomers.name": "اسم الشركة",
  "slCustomers.crNumber": "رقم السجل التجاري",
  "slCustomers.taxNumber": "الرقم الضريبي",
  "slCustomers.website": "الموقع الإلكتروني",
  "slCustomers.address": "العنوان",
  "slCustomers.city": "المدينة",
  "slCustomers.country": "الدولة",
  "slCustomers.creditLimitUnit": "حد الائتمان ({currency})",

  // Delete
  "slCustomers.deleteConfirm":
    "هل تريد حذف العميل {name}؟ سيتم فك ارتباط مركباته (دون حذفها) وحذف جهات الاتصال التابعة له. لا يمكن التراجع عن هذا الإجراء.",

  // Empty states
  "slCustomers.emptyTitle": "لا يوجد عملاء بعد",
  "slCustomers.emptyDesc":
    "أضف المنشآت العميلة التي تركّب لها محددات السرعة لتتبع مركباتها ومهامها وشهاداتها.",
  "slCustomers.emptyFilteredTitle": "لا يوجد عملاء مطابقون لعوامل التصفية",
  "slCustomers.emptyFilteredDesc": "جرّب بحثًا مختلفًا أو حالة أخرى.",

  // Errors
  "slCustomers.saveFailed": "فشل الحفظ",
  "slCustomers.deleteFailed": "فشل الحذف",
  "slCustomers.notFound": "لم يتم العثور على العميل.",

  // Detail — KPIs
  "slCustomers.vehicles": "المركبات",
  "slCustomers.kpiActiveLimiters": "محددات السرعة النشطة",
  "slCustomers.kpiJobsCompleted": "المهام المنجزة",
  "slCustomers.kpiJobsPending": "المهام المعلقة",
  "slCustomers.kpiCertsIssued": "الشهادات الصادرة",
  "slCustomers.kpiCertsExpiring": "تنتهي خلال 60 يومًا",
  "slCustomers.kpiCertsExpired": "منتهية",
  "slCustomers.kpiCompliance": "نسبة الامتثال",
  "slCustomers.complianceHint": "المركبات التي تحمل شهادة سارية",

  // Detail — contacts card
  "slCustomers.contacts": "جهات الاتصال",
  "slCustomers.addContact": "إضافة جهة اتصال",
  "slCustomers.editContact": "تعديل جهة الاتصال",
  "slCustomers.deleteContact": "حذف جهة الاتصال",
  "slCustomers.deleteContactConfirm":
    "هل تريد حذف جهة الاتصال {name}؟ لا يمكن التراجع عن هذا الإجراء.",
  "slCustomers.contactTitle": "المسمى الوظيفي",
  "slCustomers.department": "القسم",
  "slCustomers.whatsapp": "واتساب",
  "slCustomers.primaryContact": "جهة الاتصال الرئيسية",
  "slCustomers.noContacts": "لا توجد جهات اتصال بعد.",

  // Detail — vehicles card
  "slCustomers.attachVehicle": "ربط مركبة",
  "slCustomers.detachVehicle": "فك ربط المركبة",
  "slCustomers.detachConfirm":
    "هل تريد فك ربط {vehicle} من العميل {customer}؟ ستبقى المركبة في أسطولك.",
  "slCustomers.fleetNumber": "رقم الأسطول",
  "slCustomers.chassisNumber": "رقم الهيكل",
  "slCustomers.noVehicles": "لا توجد مركبات مرتبطة بعد.",
  "slCustomers.selectVehicle": "اختر مركبة…",
  "slCustomers.noUnassignedVehicles": "لا توجد مركبات غير مرتبطة متاحة.",
  "slCustomers.attach": "ربط",
  "slCustomers.attachExistingLabel": "مركبة قائمة غير مرتبطة",
  "slCustomers.createVehicleHint":
    "هل تحتاج إلى مركبة جديدة؟ أنشئها في صفحة المركبات أولًا ثم اربطها هنا.",
  "slCustomers.goToVehicles": "الانتقال إلى المركبات",

  // Detail — jobs card
  "slCustomers.jobs": "المهام",
  "slCustomers.noJobs": "لا توجد مهام بعد.",
  "slCustomers.jobNumber": "رقم المهمة",
  "slCustomers.type": "النوع",
  "slCustomers.scheduled": "الموعد المجدول",
  "slCustomers.viewAllJobs": "عرض كل المهام",

  // Detail — certificates card
  "slCustomers.certificates": "الشهادات",
  "slCustomers.noCertificates": "لا توجد شهادات بعد.",
  "slCustomers.certificateNumber": "رقم الشهادة",
  "slCustomers.expires": "تاريخ الانتهاء",
  "slCustomers.viewAllCertificates": "عرض كل الشهادات",

  // Vehicle form additions
  "slCustomers.vehicleCustomer": "العميل",
  "slCustomers.vehicleCustomerOwnFleet": "— أسطولنا الخاص —",
  "slCustomers.vehicleChassisNumber": "رقم الهيكل",
  "slCustomers.vehicleFleetNumber": "رقم الأسطول",
};
