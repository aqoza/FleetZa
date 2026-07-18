import { enSlJobs } from "../en/slJobs";

export const arSlJobs: Record<keyof typeof enSlJobs, string> = {
  "slJobs.title": "المهام",
  "slJobs.description": "جدولة مهام خدمة محددات السرعة وتنفيذها ومتابعتها",
  "slJobs.newJob": "مهمة جديدة",
  "slJobs.technicians": "الفنيون",

  // Filters
  "slJobs.allTypes": "كل الأنواع",
  "slJobs.allStatuses": "كل الحالات",
  "slJobs.allTechnicians": "كل الفنيين",
  "slJobs.allCustomers": "كل العملاء",

  // Table
  "slJobs.number": "#",
  "slJobs.type": "النوع",
  "slJobs.customer": "العميل",
  "slJobs.technician": "الفني",
  "slJobs.scheduled": "الموعد المجدول",
  "slJobs.jobNumber": "مهمة رقم {number}",

  // Empty states
  "slJobs.emptyTitle": "لا توجد مهام بعد",
  "slJobs.emptyDesc": "أنشئ مهمة لجدولة تركيب أو فحص أو خدمة أخرى.",
  "slJobs.emptyFilteredTitle": "لا توجد مهام مطابقة لعوامل التصفية",
  "slJobs.emptyFilteredDesc": "جرّب تعديل عوامل التصفية أعلاه أو مسحها.",

  // New job form
  "slJobs.jobType": "نوع المهمة",
  "slJobs.noCustomer": "بدون عميل",
  "slJobs.selectVehicle": "اختر المركبة…",
  "slJobs.vehicleFilterHint": "تُعرض مركبات هذا العميل والمركبات غير المرتبطة بعميل",
  "slJobs.device": "الجهاز",
  "slJobs.noDevice": "بدون جهاز",
  "slJobs.deviceInStockHint": "تعرض مهام التركيب والاستبدال الأجهزة المتوفرة في المخزون فقط",
  "slJobs.unassigned": "غير مُسندة",
  "slJobs.scheduledDate": "تاريخ الجدولة",
  "slJobs.setSpeedKmh": "السرعة المضبوطة (كم/س)",
  "slJobs.location": "الموقع",
  "slJobs.createJob": "إنشاء المهمة",
  "slJobs.saveFailed": "فشل الحفظ",

  // Technicians manager
  "slJobs.addTechnician": "إضافة فني",
  "slJobs.editTechnician": "تعديل الفني",
  "slJobs.noTechniciansYet": "لا يوجد فنيون بعد. أضف أول فني لإسناد المهام.",
  "slJobs.active": "نشط",
  "slJobs.inactive": "غير نشط",
  "slJobs.deactivate": "إلغاء التفعيل",
  "slJobs.reactivate": "إعادة التفعيل",

  // Detail page
  "slJobs.backToJobs": "المهام",
  "slJobs.jobNotFound": "المهمة غير موجودة",
  "slJobs.details": "التفاصيل",
  "slJobs.setSpeed": "السرعة المضبوطة",
  "slJobs.startedAt": "وقت البدء",
  "slJobs.completedAt": "وقت الإكمال",
  "slJobs.duration": "المدة",
  "slJobs.durationValue": "{minutes} دقيقة",
  "slJobs.qcApprovedInfo": "اعتماد مراقبة الجودة",
  "slJobs.customerSignature": "توقيع العميل",
  "slJobs.technicianSignature": "توقيع الفني",
  "slJobs.signed": "موقَّع",
  "slJobs.notSigned": "غير موقَّع",

  // Workflow
  "slJobs.workflow": "سير العمل",
  "slJobs.startJob": "بدء المهمة",
  "slJobs.cancelJob": "إلغاء المهمة",
  "slJobs.checklist": "قائمة التحقق",
  "slJobs.checklistProgress": "أُنجز {done} من {total}",
  "slJobs.customerSigned": "تم استلام توقيع العميل",
  "slJobs.technicianSigned": "تم تأكيد توقيع الفني",
  "slJobs.completeJob": "إكمال المهمة",
  "slJobs.statusUpdateFailed": "فشل تحديث الحالة",

  // Complete modal
  "slJobs.durationMinutes": "المدة (بالدقائق)",
  "slJobs.checklistIncomplete": "{count} من بنود قائمة التحقق غير منجزة — ملاحظة التجاوز مطلوبة.",
  "slJobs.overrideNote": "ملاحظة التجاوز",
  "slJobs.overrideNoteHint": "وضّح سبب إكمال المهمة مع وجود بنود غير منجزة في قائمة التحقق",
  "slJobs.completeFailed": "فشل إكمال المهمة",
  "slJobs.notInProgress": "هذه المهمة لم تعد قيد التنفيذ.",

  // QC & close
  "slJobs.qcApprove": "اعتماد مراقبة الجودة",
  "slJobs.closeJob": "إغلاق المهمة",

  // Issue certificate
  "slJobs.issueCertificate": "إصدار شهادة",
  "slJobs.issuingAuthority": "جهة الإصدار",
  "slJobs.expiresAt": "تاريخ الانتهاء",
  "slJobs.issueFailed": "فشل إصدار الشهادة",
  "slJobs.certIssued": "تم إصدار الشهادة {number}.",
  "slJobs.goToCertificates": "الانتقال إلى الشهادات",

  // Checklist item labels (UI translation of stored item ids)
  "slJobs.checklist.mounting": "إحكام التثبيت والتوصيلات",
  "slJobs.checklist.calibration": "معايرة السرعة المحددة",
  "slJobs.checklist.seal": "تركيب ختم الحماية من العبث",
  "slJobs.checklist.function_test": "اجتياز اختبار التشغيل والطريق",
  "slJobs.checklist.cabin_sticker": "تثبيت ملصق المقصورة",
  "slJobs.checklist.docs": "توثيق الصور والمستندات",
};
