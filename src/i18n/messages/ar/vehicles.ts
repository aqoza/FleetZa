import { enVehicles } from "../en/vehicles";

// Arabic (MSA). Glossary: مركبة (vehicle), سائق (driver), أمر عمل (work order),
// الوقود (fuel), الفحص (inspection), عطل (issue), الأسطول (fleet),
// عداد المسافة (odometer). The Record type enforces completeness.
export const arVehicles: Record<keyof typeof enVehicles, string> = {
  // Page
  "vehicles.title": "المركبات",
  "vehicles.countInFleet": "{count} مركبة في أسطولك",
  "vehicles.add": "إضافة مركبة",

  // Ownership
  "vehicles.owner": "المالك",
  "vehicles.ownerCompany": "أسطول الشركة",
  "vehicles.ownerCustomer": "عميل",
  "vehicles.selectCustomer": "اختر عميلاً…",
  "vehicles.allOwners": "كل المالكين",
  "vehicles.speedLimiterPanel": "محدد السرعة",
  "vehicles.noSpeedLimiter": "لا يوجد محدد سرعة مركّب.",
  "vehicles.chassisNumber": "رقم الهيكل",
  "vehicles.engineNumber": "رقم المحرك",
  "vehicles.fleetNumber": "رقم الأسطول",
  "vehicles.searchPlaceholder": "ابحث بالاسم أو اللوحة أو رقم الهيكل…",
  "vehicles.allStatuses": "جميع الحالات",

  // Empty states
  "vehicles.noMatch": "لا توجد مركبات مطابقة لعوامل التصفية",
  "vehicles.empty": "لا توجد مركبات بعد",
  "vehicles.noMatchHint": "جرّب بحثًا مختلفًا أو غيّر عامل تصفية الحالة أو المالك.",
  "vehicles.emptyHint": "أضف أول مركبة لبدء تتبّع الصيانة والوقود والتكاليف.",

  // Detail
  "vehicles.notFound": "لم يتم العثور على المركبة.",
  "vehicles.details": "التفاصيل",
  "vehicles.type": "النوع",
  "vehicles.fuel": "الوقود",
  "vehicles.purchased": "تاريخ الشراء",
  "vehicles.purchasePrice": "سعر الشراء",
  "vehicles.assignedDriver": "السائق المعيَّن",
  "vehicles.change": "تغيير",
  "vehicles.assign": "تعيين",
  "vehicles.since": "منذ {date}",
  "vehicles.noDriver": "لا يوجد سائق معيَّن.",
  "vehicles.openIssues": "الأعطال المفتوحة",
  "vehicles.noOpenIssues": "لا توجد أعطال مفتوحة.",
  "vehicles.recentWorkOrders": "أوامر العمل الأخيرة",
  "vehicles.noWorkOrders": "لا توجد أوامر عمل بعد.",
  "vehicles.recentFuel": "سجلّات الوقود الأخيرة",
  "vehicles.noFuelLogs": "لا توجد سجلّات وقود بعد.",

  // Speed limiter certificate. شهادة (certificate), سارية (valid/current),
  // مسحوبة (revoked — إلغاء is "cancel"), مهمة (speed limiter job — أمر عمل is
  // the maintenance work order), مراقبة الجودة (QC).
  "vehicles.currentCertificate": "الشهادة الحالية",
  "vehicles.certificateHistory": "الشهادات السابقة",
  "vehicles.renewCertificate": "تجديد الشهادة",
  "vehicles.noCertificate": "لم تُصدَر أي شهادة لهذه المركبة بعد.",
  "vehicles.noCertificateHint":
    "تُصدَر الشهادة من مهمة لمحدد السرعة بعد اعتماد مراقبة الجودة للعمل.",
  "vehicles.noValidCertificate": "لا تحمل هذه المركبة شهادة سارية.",
  "vehicles.noValidCertificateHint":
    "تم سحب شهادتها الأخيرة. تُصدَر شهادة بديلة من مهمة جديدة لمحدد السرعة.",
  "vehicles.createSlJob": "إنشاء مهمة لمحدد السرعة",
  "vehicles.certificatesError":
    "تعذّر تحميل الشهادات، لذا فإن حالة شهادة هذه المركبة غير معروفة. أعد تحميل الصفحة قبل إصدار شهادة جديدة.",

  // Modals
  "vehicles.edit": "تعديل المركبة",
  "vehicles.assignDriver": "تعيين سائق",
  "vehicles.unassignHint": "اتركه فارغًا لإلغاء التعيين",
  "vehicles.unassigned": "— غير معيَّن —",
  "vehicles.delete": "حذف المركبة",
  "vehicles.deleteConfirmPrefix": "هل تريد حذف",
  "vehicles.deleteConfirmSuffix":
    "وكل سجلّاته (الوقود وأوامر العمل والفحوصات)؟ لا يمكن التراجع عن هذا الإجراء.",

  // Form
  "vehicles.saveFailed": "فشل الحفظ",
  "vehicles.nameLabel": "الاسم / رقم الوحدة",
  "vehicles.fuelType": "نوع الوقود",
  "vehicles.odometerUnit": "عداد المسافة ({unit})",
  "vehicles.purchaseDate": "تاريخ الشراء",
  "vehicles.purchasePriceUnit": "سعر الشراء ({currency})",
};
