import { enReports } from "../en/reports";

// Arabic (MSA). Glossary: التقرير (report), التكلفة (cost), الإجمالي (total),
// الوقود (fuel), كفاءة الوقود (fuel efficiency), الأسطول (fleet),
// الضريبة (tax), مركبة (vehicle), أمر عمل (work order).
export const arReports: Record<keyof typeof enReports, string> = {
  "reports.title": "التقارير",
  "reports.subtitle": "التكلفة وكفاءة الوقود عبر الأسطول",

  "reports.period30": "آخر 30 يومًا",
  "reports.period90": "آخر 90 يومًا",
  "reports.period365": "آخر 365 يومًا",

  "reports.costPerVehicle": "التكلفة لكل مركبة",
  "reports.noCostsTitle": "لا توجد تكاليف في هذه الفترة",
  "reports.noCostsDesc":
    "ستظهر هنا سجلات الوقود وأوامر العمل المكتملة ضمن الفترة المحددة.",
  "reports.totalCost": "إجمالي التكلفة",
  "reports.fuel": "الوقود",
  "reports.maintenance": "الصيانة",
  "reports.maintenanceInclTax": "الصيانة (شاملة الضريبة)",
  "reports.total": "الإجمالي",
  "reports.costPerDistance": "التكلفة / {unit}",

  "reports.fuelEfficiency": "كفاءة الوقود",
  "reports.noFuelTitle": "لا توجد سجلات وقود في هذه الفترة",
  "reports.noFuelDesc": "سجّل عمليات التعبئة لعرض حجم الوقود وكفاءته لكل مركبة.",
  "reports.fillUps": "عمليات التعبئة",
  "reports.volume": "الحجم",
  "reports.avgEfficiency": "متوسط الكفاءة",

  "reports.unknownVehicle": "مركبة غير معروفة",
};
