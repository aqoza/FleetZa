import { enAuth } from "../en/auth";

// Arabic (MSA). Keep terminology consistent with the glossary:
// المؤسسة (organization), دعوة (invitation), الضريبة (tax).
export const arAuth: Record<keyof typeof enAuth, string> = {
  "auth.middleEast": "الشرق الأوسط",
  "auth.otherCountries": "دول أخرى",
  "auth.taxHint": "سيتم تطبيق {label} بنسبة {rate}% على تكاليف الصيانة.",

  "auth.joinOrg": "الانضمام إلى {org}",
  "auth.invitedAs": "لقد تمت دعوتك بصفة {role} ({email}).",
  "auth.choosePassword": "اختر كلمة المرور",
  "auth.joinOrganization": "الانضمام إلى المؤسسة",
  "auth.inviteProblem": "مشكلة في الدعوة",
  "auth.checkingInvite": "جارٍ التحقق من الدعوة…",
  "auth.inviteMissingToken": "رابط الدعوة هذا يفتقد رمزه المميز.",
  "auth.inviteNotFound": "لم يتم العثور على الدعوة",
  "auth.inviteAcceptFailed": "تعذّر قبول الدعوة",
  "auth.inviteHelp": "اطلب من المسؤول إرسال دعوة جديدة، أو",
  "auth.signInLink": "تسجيل الدخول",
};
