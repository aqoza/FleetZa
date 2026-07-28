import { enCustomers } from "../en/customers";

export const arCustomers: Record<keyof typeof enCustomers, string> = {
  // Page
  "customers.title": "العملاء",
  "customers.subtitle": "المنشآت العميلة التي تتعامل معها — جهات الاتصال والمركبات والسجلات",
  "customers.newCustomer": "عميل جديد",
  "customers.editCustomer": "تعديل العميل",
  "customers.deleteCustomer": "حذف العميل",
  "customers.searchPlaceholder": "ابحث بالاسم أو رقم السجل التجاري أو الهاتف أو البريد الإلكتروني…",
  "customers.allStatuses": "كل الحالات",

  // Status
  "customers.status.active": "نشط",
  "customers.status.inactive": "غير نشط",

  // List table
  "customers.company": "الشركة",
  "customers.cityCountry": "المدينة / الدولة",
  "customers.contact": "جهة الاتصال",
  "customers.billingTerms": "شروط الفوترة",
  "customers.creditLimit": "حد الائتمان",

  // Form fields
  "customers.name": "اسم الشركة",
  "customers.crNumber": "رقم السجل التجاري",
  "customers.taxNumber": "الرقم الضريبي",
  "customers.website": "الموقع الإلكتروني",
  "customers.address": "العنوان",
  "customers.city": "المدينة",
  "customers.country": "الدولة",
  "customers.creditLimitUnit": "حد الائتمان ({currency})",

  // Delete
  "customers.deleteConfirm":
    "هل تريد حذف العميل {name}؟ سيتم فك ارتباط مركباته (دون حذفها) وحذف جهات الاتصال التابعة له. لا يمكن التراجع عن هذا الإجراء.",

  // Empty states
  "customers.emptyTitle": "لا يوجد عملاء بعد",
  "customers.emptyDesc":
    "أضف المنشآت العميلة التي تتعامل معها لتتبع جهات اتصالها ومركباتها وسجلاتها.",
  "customers.emptyFilteredTitle": "لا يوجد عملاء مطابقون لعوامل التصفية",
  "customers.emptyFilteredDesc": "جرّب بحثًا مختلفًا أو حالة أخرى.",

  // Errors
  "customers.saveFailed": "فشل الحفظ",
  "customers.deleteFailed": "فشل الحذف",
  "customers.notFound": "لم يتم العثور على العميل.",

  // Detail — KPIs
  "customers.vehicles": "المركبات",
  "customers.kpiActiveLimiters": "محددات السرعة النشطة",
  "customers.kpiJobsCompleted": "المهام المنجزة",
  "customers.kpiJobsPending": "المهام المعلقة",
  "customers.kpiCertsIssued": "الشهادات الصادرة",
  "customers.kpiCertsExpiring": "تنتهي خلال 60 يومًا",
  "customers.kpiCertsExpired": "منتهية",
  "customers.expiredHint": "لم تُجدَّد بعد",
  "customers.kpiCompliance": "نسبة الامتثال",
  "customers.complianceHint": "المركبات التي تحمل شهادة حالية غير منتهية ÷ المركبات المرتبطة",

  // Detail — contacts card
  "customers.contacts": "جهات الاتصال",
  "customers.addContact": "إضافة جهة اتصال",
  "customers.editContact": "تعديل جهة الاتصال",
  "customers.deleteContact": "حذف جهة الاتصال",
  "customers.deleteContactConfirm":
    "هل تريد حذف جهة الاتصال {name}؟ لا يمكن التراجع عن هذا الإجراء.",
  "customers.contactTitle": "المسمى الوظيفي",
  "customers.department": "القسم",
  "customers.whatsapp": "واتساب",
  "customers.primaryContact": "جهة الاتصال الرئيسية",
  "customers.noContacts": "لا توجد جهات اتصال بعد.",

  // Detail — vehicles card
  "customers.attachVehicle": "ربط مركبة",
  "customers.detachVehicle": "فك ربط المركبة",
  "customers.detachConfirm":
    "هل تريد فك ربط {vehicle} من العميل {customer}؟ ستبقى المركبة في أسطولك.",
  "customers.fleetNumber": "رقم الأسطول",
  "customers.chassisNumber": "رقم الهيكل",
  "customers.noVehicles": "لا توجد مركبات مرتبطة بعد.",
  "customers.attach": "ربط",
  "customers.attachExistingLabel": "مركبة قائمة غير مرتبطة",
  "customers.attachSearchPlaceholder": "الاسم أو اللوحة أو رقم الأسطول أو الهيكل أو VIN…",
  "customers.createVehicleHint":
    "هل تحتاج إلى مركبة جديدة؟ أنشئها في صفحة المركبات أولًا ثم اربطها هنا.",
  "customers.goToVehicles": "الانتقال إلى المركبات",

  // Detail — vehicles card: search, certificate status filter, renewal
  "customers.vehicleSearchPlaceholder": "الاسم أو اللوحة أو رقم الأسطول أو الهيكل أو VIN…",
  "customers.vehicleFilterAll": "الكل",
  "customers.vehicleFilterValid": "سارية",
  "customers.vehicleFilterExpiring": "خلال 60 يومًا",
  "customers.vehicleFilterExpired": "منتهية",
  "customers.vehicleFilterNarrowHint":
    "يتم عرض أول {count} مركبة مطابقة فقط — استخدم البحث لتضييق القائمة.",
  "customers.vehicleCertificate": "الشهادة",
  "customers.vehicleNoCertificate": "لا توجد شهادة",
  "customers.renewCertificate": "تجديد الشهادة",
  "customers.noVehiclesFilteredTitle": "لا توجد مركبات مطابقة لعوامل التصفية",
  "customers.noVehiclesFilteredDesc": "جرّب بحثًا مختلفًا أو حالة شهادة أخرى.",

  // Detail — jobs card
  "customers.jobs": "المهام",
  "customers.noJobs": "لا توجد مهام بعد.",
  "customers.jobNumber": "رقم المهمة",
  "customers.type": "النوع",
  "customers.scheduled": "الموعد المجدول",
  "customers.viewAllJobs": "عرض كل المهام",

  // Detail — certificates card
  "customers.certificates": "الشهادات",
  "customers.noCertificates": "لا توجد شهادات بعد.",
  "customers.certificateNumber": "رقم الشهادة",
  "customers.expires": "تاريخ الانتهاء",
  "customers.viewAllCertificates": "عرض كل الشهادات",
  "customers.certsIncludeHistory": "إظهار المُستبدَلة",
};
