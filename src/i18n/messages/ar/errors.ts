import { enErrors } from "../en/errors";

export const arErrors: Record<keyof typeof enErrors, string> = {
  "errors.duplicate": "هذا السجل يتعارض مع سجل موجود بالفعل (قيمة مكررة).",
  "errors.referenced": "هذا السجل مرتبط بسجلات أخرى ولا يمكن تغييره بهذه الطريقة.",
  "errors.forbidden": "ليست لديك صلاحية للقيام بذلك.",
  "errors.vehicleHasCertificates":
    "لهذه المركبة شهادات صادرة ولا يمكن حذفها. قم بإخراجها من الخدمة بدلًا من ذلك.",
  "errors.vehicleHasCompletedJobs":
    "لهذه المركبة مهام منجزة مسجلة ولا يمكن حذفها. قم بإخراجها من الخدمة بدلًا من ذلك.",
  "errors.vehicleHasCompletedWorkOrders":
    "لهذه المركبة أوامر عمل منجزة مسجلة ولا يمكن حذفها. قم بإخراجها من الخدمة بدلًا من ذلك.",
  "errors.customerHasCertificates":
    "لهذا العميل شهادات صادرة ولا يمكن حذفه. اجعله غير نشط بدلًا من ذلك.",
  "errors.customerHasCompletedJobs":
    "لهذا العميل مهام منجزة مسجلة ولا يمكن حذفه. اجعله غير نشط بدلًا من ذلك.",
  "errors.illegalJobTransition": "تغيير الحالة هذا غير مسموح به من الحالة الحالية للمهمة.",
  "errors.jobNotCertifiable":
    "لا يمكن إصدار شهادة إلا لمهمة تركيب أو استبدال أو فحص مكتملة.",
  "errors.jobNotFound": "لم يتم العثور على المهمة.",
  "errors.certAlreadyIssued": "توجد بالفعل شهادة سارية صادرة لهذه المهمة.",

  // مستندات المبيعات والفوترة
  "errors.customerHasInvoices":
    "لهذا العميل فواتير صادرة ولا يمكن حذفه. اجعله غير نشط بدلًا من ذلك.",
  "errors.docNotEditable":
    "لم يعد هذا المستند مسودة، لذا لا يمكن تعديل بنوده. أنشئ مراجعة جديدة بدلًا من ذلك.",
  "errors.docLocked":
    "تم إصدار هذا المستند ولم يعد قابلًا للتعديل. أنشئ مراجعة جديدة بدلًا من ذلك.",
  "errors.docNotDeletable":
    "لا يمكن حذف سوى المستندات المسودة — قم بإلغاء هذا المستند بدلًا من ذلك للحفاظ على تسلسل الترقيم.",
  "errors.emptyDocument": "أضف بندًا واحدًا على الأقل قبل إصدار هذا المستند.",
  "errors.illegalQuoteTransition":
    "تغيير الحالة هذا غير مسموح به من الحالة الحالية لعرض السعر.",
  "errors.illegalOrderTransition":
    "تغيير الحالة هذا غير مسموح به من الحالة الحالية لأمر البيع.",
  "errors.illegalInvoiceTransition":
    "تغيير الحالة هذا غير مسموح به من الحالة الحالية للفاتورة.",
  "errors.quoteNotFound": "لم يتم العثور على عرض السعر.",
  "errors.quoteNotConvertible": "لا يمكن تحويل عرض السعر إلى أمر بيع إلا بعد قبوله.",
  "errors.quoteAlreadyConverted": "تم تحويل عرض السعر هذا إلى أمر بيع بالفعل.",
  "errors.quoteNotRevisable": "يمكن تعديل عرض السعر المسودة مباشرة — لا حاجة إلى مراجعة جديدة.",
  "errors.orderNotFound": "لم يتم العثور على أمر البيع.",
  "errors.orderNotInvoiceable": "قم بتأكيد أمر البيع قبل إصدار فاتورة له.",
  "errors.invoiceExceedsOrder":
    "الكمية أكبر من المتبقي في أمر البيع. قلّل الكمية ثم حاول مرة أخرى.",
  "errors.nothingToInvoice":
    "تمت فوترة هذا الأمر بالكامل — لا يوجد ما يمكن فوترته.",
  "errors.invoiceNotFound": "لم يتم العثور على الفاتورة.",
  "errors.invoiceNotPayable": "قم بإصدار الفاتورة قبل تسجيل دفعة عليها.",
  "errors.paymentExceedsBalance": "قيمة الدفعة أكبر من الرصيد المستحق على الفاتورة.",

  // فوترة الشهادات
  "errors.certAlreadyInvoiced":
    "إحدى هذه الشهادات مدرجة بالفعل في فاتورة. ألغِ تلك الفاتورة أولًا إن كانت قد أُنشئت بالخطأ.",
  "errors.certsMultipleCustomers":
    "الفاتورة تُصدَر لعميل واحد — اختر شهادات تخص عميلًا واحدًا.",
  "errors.certNoCustomer":
    "لا يوجد عميل مرتبط بهذه الشهادة لفوترته. حدّد مالك المركبة أولًا.",
  "errors.certificateNotFound": "لم يتم العثور على الشهادة.",
  "errors.noCertificates": "اختر شهادة واحدة على الأقل لفوترتها.",
};
