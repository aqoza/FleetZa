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
};
