import { enModules } from "../en/modules";

// Arabic (MSA). Glossary: وحدة (module), محدد السرعة (speed limiter),
// شهادة (certificate), تركيب (installation), جهاز (device), أسطول (fleet).
export const arModules: Record<keyof typeof enModules, string> = {
  // --- Fleet operations ---
  "modules.fleet.name": "إدارة الأسطول",
  "modules.fleet.description": "تابع مركباتك وحالتها ومستنداتها وسجلها الكامل في مكان واحد.",
  "modules.drivers.name": "إدارة السائقين",
  "modules.drivers.description": "أدر ملفات السائقين ورخصهم وإسنادهم إلى المركبات.",
  "modules.fuel.name": "إدارة الوقود",
  "modules.fuel.description": "سجّل تعبئات الوقود وتابع الاستهلاك وتحكم في تكاليف الوقود عبر أسطولك.",
  "modules.gps_tracking.name": "التتبع عبر GPS والتليماتكس",
  "modules.gps_tracking.description": "شاهد مواقع المركبات ومساراتها وبيانات التليماتكس مباشرةً في الوقت الفعلي.",
  "modules.driver_behavior.name": "سلوك السائقين والتقييم",
  "modules.driver_behavior.description": "راقب السرعة الزائدة والفرملة المفاجئة وغيرها من الأحداث لتقييم السائقين وتوجيههم.",
  "modules.trip_planning.name": "تخطيط الرحلات والمسارات",
  "modules.trip_planning.description": "خطط الرحلات وحسّن المسارات لتوفير الوقت والوقود.",
  "modules.dispatch.name": "إدارة الإرسال",
  "modules.dispatch.description": "أسند المهام إلى السائقين والمركبات وتابع تنفيذها في الوقت الفعلي.",

  // --- Maintenance & workshop ---
  "modules.maintenance.name": "صيانة المركبات",
  "modules.maintenance.description": "سجّل أعمال الصيانة والإصلاح واحتفظ بسجل صيانة كامل لكل مركبة.",
  "modules.preventive.name": "الصيانة الوقائية",
  "modules.preventive.description": "جدول الصيانة الدورية حسب التاريخ أو المسافة لمعالجة الأعطال قبل وقوعها.",
  "modules.inspections.name": "فحوصات المركبات",
  "modules.inspections.description": "نفّذ قوائم فحص رقمية للمركبات واكتشف الأعطال مبكرًا.",
  "modules.issues.name": "تتبع الأعطال",
  "modules.issues.description": "بلّغ عن مشكلات المركبات وتابعها من الاكتشاف حتى الحل.",
  "modules.workshop.name": "إدارة الورشة",
  "modules.workshop.description": "أدر أوامر العمل والفنيين وأعمال الإصلاح في ورشتك.",
  "modules.predictive_ai.name": "المساعد الذكي والصيانة التنبؤية",
  "modules.predictive_ai.description": "دع الذكاء الاصطناعي يتنبأ بالأعطال ويقترح الصيانة قبل حدوث التوقفات.",

  // --- Compliance & certification ---
  "modules.renewals.name": "التجديدات وانتهاء المستندات",
  "modules.renewals.description": "تابع تواريخ انتهاء التسجيل والتأمين والتصاريح مع تذكيرات في الوقت المناسب.",
  "modules.speed_limiters.name": "توريد وتركيب محددات السرعة",
  "modules.speed_limiters.description": "أدر أجهزة محددات السرعة وعمليات تركيبها وحالتها عبر مركباتك.",
  "modules.sl_certificates.name": "شهادات محددات السرعة",
  "modules.sl_certificates.description": "أصدر شهادات محددات السرعة وتابع تواريخ تجديدها.",
  "modules.insurance_mgmt.name": "إدارة التأمين",
  "modules.insurance_mgmt.description": "أدر وثائق التأمين والتغطيات والمطالبات الخاصة بأسطولك.",
  "modules.incidents.name": "إدارة الحوادث والوقائع",
  "modules.incidents.description": "سجّل الحوادث والوقائع وتابع الإصلاحات والمطالبات.",
  "modules.regulatory.name": "الامتثال والمتطلبات التنظيمية",
  "modules.regulatory.description": "التزم بلوائح النقل ومتطلبات الجهات الرسمية.",

  // --- Logistics & transport ---
  "modules.tms.name": "إدارة النقل (TMS)",
  "modules.tms.description": "خطط وأدر أوامر الشحن والحمولات وعمليات النقل من البداية إلى النهاية.",
  "modules.logistics_delivery.name": "الخدمات اللوجستية والتوصيل",
  "modules.logistics_delivery.description": "أدر عمليات التوصيل وإثبات التسليم وعمليات الميل الأخير.",
  "modules.assets.name": "إدارة الأصول",
  "modules.assets.description": "تابع المعدات والأصول الأخرى غير المركبات مع سجل الإسناد والقيمة.",
  "modules.inventory.name": "المخزون والمستودعات",
  "modules.inventory.description": "أدر قطع الغيار ومستويات المخزون وعمليات المستودعات.",

  // --- Commerce ---
  "modules.purchasing.name": "المشتريات",
  "modules.purchasing.description": "أنشئ أوامر الشراء وأدر الموردين وعمليات الشراء.",
  "modules.sales.name": "المبيعات",
  "modules.sales.description": "أدر عروض الأسعار وأوامر البيع والعملاء.",
  "modules.pos.name": "نقاط البيع",
  "modules.pos.description": "بع المنتجات والخدمات مباشرةً عبر شاشة نقاط بيع سريعة.",
  "modules.crm.name": "إدارة علاقات العملاء",
  "modules.crm.description": "تابع العملاء المحتملين والفرص وعلاقات العملاء عبر مراحل البيع.",

  // --- Finance ---
  "modules.finance.name": "المالية والمحاسبة",
  "modules.finance.description": "أدر الحسابات والقيود والقوائم المالية لشركتك.",
  "modules.billing.name": "الفوترة والفواتير",
  "modules.billing.description": "أنشئ الفواتير وتابع المدفوعات وأدر فوترة العملاء.",
  "modules.contracts.name": "إدارة العقود",
  "modules.contracts.description": "أنشئ العقود وتابع بنودها وتواريخ تجديدها.",

  // --- People ---
  "modules.payroll_hr.name": "الرواتب والموارد البشرية",
  "modules.payroll_hr.description": "أدر سجلات الموظفين والحضور والرواتب.",
  "modules.mobile_workforce.name": "القوى العاملة الميدانية",
  "modules.mobile_workforce.description": "امنح موظفي الميدان وصولًا عبر الجوال إلى مهامهم ونماذجهم وتحديثاتهم.",

  // --- Customer & partners ---
  "modules.customer_portal.name": "بوابة العملاء",
  "modules.customer_portal.description": "امنح عملاءك بوابة خدمة ذاتية للاطلاع على طلباتهم وفواتيرهم ومستنداتهم.",
  "modules.vendor_portal.name": "بوابة الموردين",
  "modules.vendor_portal.description": "أتح لمورديك الاطلاع على الطلبات وتقديم الفواتير عبر بوابة خدمة ذاتية.",

  // --- Analytics ---
  "modules.reports.name": "التقارير",
  "modules.reports.description": "تقارير جاهزة عن المركبات والتكاليف والعمليات قابلة للتصدير في أي وقت.",
  "modules.bi_analytics.name": "ذكاء الأعمال والتحليلات",
  "modules.bi_analytics.description": "أنشئ لوحات المعلومات وحلل الاتجاهات عبر جميع بياناتك.",

  // --- Platform ---
  "modules.documents.name": "إدارة المستندات",
  "modules.documents.description": "خزّن مستندات الشركة ونظمها وشاركها بأمان.",
  "modules.workflow_automation.name": "أتمتة سير العمل",
  "modules.workflow_automation.description": "أتمت الموافقات والإشعارات والمهام المتكررة بقواعد مخصصة.",
  "modules.integrations.name": "واجهات API والتكاملات",
  "modules.integrations.description": "اربط أنظمتك الأخرى عبر واجهات برمجة التطبيقات وتكاملات جاهزة.",
  "modules.iot_devices.name": "إدارة أجهزة إنترنت الأشياء",
  "modules.iot_devices.description": "أدر المستشعرات والأجهزة المتصلة التي ترسل بياناتها من أسطولك.",
  "modules.notifications.name": "الإشعارات والتواصل",
  "modules.notifications.description": "أرسل التنبيهات والتذكيرات عبر البريد الإلكتروني والرسائل النصية وداخل التطبيق.",
  "modules.audit_security.name": "سجلات التدقيق والأمان",
  "modules.audit_security.description": "تتبع كل تغيير عبر سجلات التدقيق وضوابط أمنية متقدمة.",
  "modules.multi_company.name": "إدارة الشركات المتعددة",
  "modules.multi_company.description": "أدر عدة شركات أو فروع من حساب واحد.",

  // --- ModuleGate screen ---
  "modules.gate.title": "هذه الوحدة غير مفعّلة",
  "modules.gate.adminHint": "فعّلها من الإعدادات ← الوحدات لاستخدام هذه الميزة.",
  "modules.gate.memberHint": "اطلب من أحد المسؤولين تفعيل هذه الوحدة لمؤسستك.",
  "modules.gate.manage": "إدارة الوحدات",
};
