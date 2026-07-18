import { enMaintenance } from "../en/maintenance";

// Arabic (MSA). Glossary: الصيانة (maintenance), تذكير الصيانة (service reminder),
// أمر عمل (work order), مركبة (vehicle), عداد المسافة (odometer),
// الأولوية (priority), المورّد (vendor), تاريخ الاستحقاق (due date),
// متأخر (overdue), الضريبة (tax), المجموع الفرعي (subtotal), الإجمالي (total).
export const arMaintenance: Record<keyof typeof enMaintenance, string> = {
  // Page
  "maintenance.title": "الصيانة",
  "maintenance.subtitle": "تذكيرات الصيانة وأوامر العمل لأسطولك",
  "maintenance.tabReminders": "تذكيرات الصيانة",
  "maintenance.tabWorkOrders": "أوامر العمل",

  // Service reminders
  "maintenance.addReminder": "إضافة تذكير",
  "maintenance.editReminder": "تعديل التذكير",
  "maintenance.deleteReminder": "حذف التذكير",
  "maintenance.allReminders": "كل التذكيرات",
  "maintenance.noRemindersMatch": "لا توجد تذكيرات مطابقة للتصفية",
  "maintenance.noRemindersYet": "لا توجد تذكيرات صيانة بعد",
  "maintenance.tryDifferentFilter": "جرّب تصفية مختلفة.",
  "maintenance.remindersEmptyDesc":
    "أنشئ تذكيرات للحفاظ على المركبات ضمن جدول الصيانة الدورية.",
  "maintenance.deleteReminderConfirm": "هل تريد حذف {task} للمركبة {vehicle}؟ لا يمكن التراجع عن هذا الإجراء.",

  // Reminder form
  "maintenance.selectVehicle": "اختر مركبة…",
  "maintenance.task": "المهمة",
  "maintenance.taskPlaceholder": "مثال: تغيير الزيت",
  "maintenance.intervalMonths": "الفاصل (بالأشهر)",
  "maintenance.intervalMonthsHint": "يتكرر كل عدة أشهر",
  "maintenance.intervalDistance": "الفاصل ({unit})",
  "maintenance.intervalDistanceHint": "يتكرر كل عدة {unit}",
  "maintenance.dueOdometer": "عداد المسافة المستحق ({unit})",

  // Reminder table
  "maintenance.due": "الاستحقاق",
  "maintenance.lastDone": "آخر إنجاز",
  "maintenance.markDone": "تحديد كمنجَز",
  "maintenance.markDoneAria": "تحديد {task} كمنجَز",
  "maintenance.editAria": "تعديل {name}",
  "maintenance.deleteAria": "حذف {name}",

  // Reminder status
  "maintenance.reminderStatus.overdue": "متأخر",
  "maintenance.reminderStatus.dueSoon": "مستحق قريبًا",
  "maintenance.reminderStatus.ok": "جيد",
  "maintenance.reminderStatus.inactive": "غير نشط",

  // Work orders — list & form
  "maintenance.newWorkOrder": "أمر عمل جديد",
  "maintenance.createWorkOrder": "إنشاء أمر عمل",
  "maintenance.allStatuses": "كل الحالات",
  "maintenance.noWorkOrdersMatch": "لا توجد أوامر عمل مطابقة للتصفية",
  "maintenance.noWorkOrdersYet": "لا توجد أوامر عمل بعد",
  "maintenance.tryDifferentStatusFilter": "جرّب تصفية حالة مختلفة.",
  "maintenance.workOrdersEmptyDesc":
    "أنشئ أوامر عمل لتتبع الإصلاحات والصيانة المجدولة.",
  "maintenance.woTitle": "العنوان",
  "maintenance.woTitlePlaceholder": "مثال: استبدال تيل الفرامل الأمامية",
  "maintenance.description": "الوصف",
  "maintenance.scheduledDate": "تاريخ الجدولة",
  "maintenance.scheduled": "التاريخ المجدول",
  "maintenance.odometerUnit": "عداد المسافة ({unit})",
  "maintenance.inclTax": "شاملة {label} {rate}%",

  // Work order detail
  "maintenance.workOrderNumber": "أمر عمل رقم {number}",
  "maintenance.workOrderNotFound": "أمر العمل غير موجود.",
  "maintenance.startWork": "بدء العمل",
  "maintenance.complete": "إكمال",
  "maintenance.reopen": "إعادة الفتح",
  "maintenance.details": "التفاصيل",
  "maintenance.completed": "تاريخ الإكمال",
  "maintenance.vehicleCurrentlyAt": "المركبة حاليًا عند {distance}",
  "maintenance.statusUpdateFailed": "تعذّر تحديث الحالة",

  // Line items
  "maintenance.lineItems": "بنود العمل",
  "maintenance.category": "الفئة",
  "maintenance.qty": "الكمية",
  "maintenance.unitCost": "تكلفة الوحدة",
  "maintenance.lineTotal": "إجمالي البند",
  "maintenance.noLineItems": "لا توجد بنود بعد.",
  "maintenance.subtotal": "المجموع الفرعي",
  "maintenance.taxLine": "{label} ({rate}%)",
  "maintenance.total": "الإجمالي",
  "maintenance.linePlaceholder": "مثال: تيل فرامل",
  "maintenance.unitCostCurrency": "تكلفة الوحدة ({currency})",
  "maintenance.lineAddFailed": "تعذّرت إضافة البند",
  "maintenance.lineDeleteFailed": "تعذّر حذف البند",

  // Line categories
  "maintenance.lineCategory.labor": "عمالة",
  "maintenance.lineCategory.part": "قطعة",
  "maintenance.lineCategory.fee": "رسوم",
  "maintenance.lineCategory.other": "أخرى",

  // Work order modals
  "maintenance.editWorkOrder": "تعديل أمر العمل",
  "maintenance.deleteWorkOrder": "حذف أمر العمل",
  "maintenance.deleteWorkOrderConfirm":
    "هل تريد حذف أمر العمل رقم {number} وجميع بنوده؟ لا يمكن التراجع عن هذا الإجراء.",
  "maintenance.deleteLineItem": "حذف البند",
  "maintenance.deleteLineConfirm": "هل تريد حذف {description}؟ لا يمكن التراجع عن هذا الإجراء.",

  // Error fallbacks
  "maintenance.saveFailed": "فشل الحفظ",
  "maintenance.updateFailed": "فشل التحديث",
  "maintenance.deleteFailed": "فشل الحذف",
};
