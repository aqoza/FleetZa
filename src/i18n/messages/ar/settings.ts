import { enSettings } from "../en/settings";

// Arabic (MSA). Glossary: الإعدادات (settings), المؤسسة (organization),
// عضو (member), دعوة (invitation), الضريبة (tax), تجديد (renewal),
// المسافة/الحجم (distance/volume). The Record type enforces completeness.
export const arSettings: Record<keyof typeof enSettings, string> = {
  // Page
  "settings.title": "الإعدادات",
  "settings.subtitle": "مؤسستك وأعضاء فريقك والدعوات",
  "settings.tab.organization": "المؤسسة",
  "settings.tab.members": "الأعضاء",
  "settings.tab.invitations": "الدعوات",
  "settings.adminsOnlyInvitations": "إدارة الدعوات متاحة للمدراء فقط.",

  // Organization form
  "settings.orgName": "اسم المؤسسة",
  "settings.country": "الدولة",
  "settings.countryChangeHint":
    "تغيير الدولة يُحدّث التنسيقات وإعدادات الضريبة الافتراضية للمؤسسة بأكملها.",
  "settings.currency": "العملة",
  "settings.timezone": "المنطقة الزمنية",
  "settings.middleEast": "الشرق الأوسط",
  "settings.otherCountries": "دول أخرى",
  "settings.distance": "المسافة",
  "settings.volume": "الحجم",
  "settings.kilometers": "كيلومترات",
  "settings.miles": "أميال",
  "settings.liters": "لترات",
  "settings.gallons": "جالونات (أمريكي)",
  "settings.saved": "تم الحفظ.",
  "settings.saveFailed": "فشل الحفظ",

  // Organization read-only view
  "settings.distanceUnit": "وحدة المسافة",
  "settings.volumeUnit": "وحدة الحجم",
  "settings.created": "تاريخ الإنشاء",

  // Country profile card
  "settings.countryProfile": "ملف الدولة",
  "settings.countryProfileDesc": "الإعدادات الافتراضية لـ {name} مُطبّقة عبر التطبيق.",
  "settings.egSample": "— مثال: {sample}",
  "settings.dateFormat": "تنسيق التاريخ",
  "settings.tax": "الضريبة",
  "settings.noTax": "بدون {label}",
  "settings.renewalDefaults": "إعدادات التجديد الافتراضية",
  "settings.everyMonths": "كل {count} شهر",

  // Members
  "settings.role": "الدور",
  "settings.joined": "تاريخ الانضمام",
  "settings.noMembers": "لا يوجد أعضاء بعد",
  "settings.noMembersDesc": "ادعُ زملاءك من علامة تبويب الدعوات.",
  "settings.roleForAria": "دور {name}",
  "settings.roleChangeFailed": "فشل تغيير الدور",
  "settings.removeFailed": "فشلت الإزالة",
  "settings.removeMember": "إزالة العضو",
  "settings.removeMemberConfirmPre": "هل تريد إزالة",
  "settings.removeMemberConfirmPost": "من المؤسسة؟ سيفقد صلاحية الوصول فورًا.",

  // Invitations
  "settings.inviteMember": "دعوة عضو",
  "settings.createInvitation": "إنشاء دعوة",
  "settings.inviteFailed": "فشلت الدعوة",
  "settings.revokeFailed": "فشل الإلغاء",
  "settings.invited": "تاريخ الدعوة",
  "settings.revoke": "إلغاء",
  "settings.revokeInvitation": "إلغاء الدعوة",
  "settings.noInvitations": "لا توجد دعوات بعد",
  "settings.noInvitationsDesc": "ادعُ زملاءك لمنحهم صلاحية الوصول إلى مساحة عمل أسطولك.",
  "settings.inviteLinkHint":
    "أرسل رابط الدعوة إلى زميلك — لا يرسله التطبيق عبر البريد الإلكتروني بعد.",
  "settings.revokeInvitationConfirmPre": "هل تريد إلغاء الدعوة الموجهة إلى",
  "settings.revokeInvitationConfirmPost": "؟ سيتوقف رابط الدعوة عن العمل.",
  "settings.statusPending": "قيد الانتظار",
  "settings.statusAccepted": "مقبولة",
  "settings.statusRevoked": "ملغاة",
  "settings.statusExpired": "منتهية",
};
