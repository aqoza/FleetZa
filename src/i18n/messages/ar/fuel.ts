import { enFuel } from "../en/fuel";

// Arabic (MSA). Fuel module — الوقود / تعبئة (fill-up). Keep terminology
// consistent with the glossary: مركبة (vehicle), سائق (driver),
// عداد المسافة (odometer), التكلفة (cost), الإجمالي (total).
export const arFuel: Record<keyof typeof enFuel, string> = {
  "fuel.title": "الوقود",
  "fuel.logCount": "{count} سجل وقود",
  "fuel.logFuel": "تسجيل تعبئة",

  "fuel.allVehicles": "كل المركبات",

  "fuel.selectVehicle": "اختر مركبة…",
  "fuel.noDriver": "— بدون —",
  "fuel.filledAt": "تاريخ التعبئة",
  "fuel.volume": "الكمية",
  "fuel.totalCost": "التكلفة الإجمالية",
  "fuel.fullTank": "خزان ممتلئ",
  "fuel.saveFailed": "فشل الحفظ",

  "fuel.totalSpend": "إجمالي الإنفاق",
  "fuel.totalVolume": "إجمالي الكمية",
  "fuel.avgPrice": "متوسط السعر",

  "fuel.price": "السعر",
  "fuel.efficiency": "الكفاءة",

  "fuel.emptyTitle": "لا توجد سجلات وقود بعد",
  "fuel.emptyDesc": "سجّل عمليات التعبئة لتتبع إنفاق الوقود وكفاءته لكل مركبة.",
  "fuel.emptyFilteredTitle": "لا توجد سجلات وقود لهذه المركبة",
  "fuel.emptyFilteredDesc": "جرّب تصفية مركبة مختلفة.",

  "fuel.deleteLog": "حذف سجل الوقود",
  "fuel.deleteButton": "حذف السجل",
  "fuel.deleteConfirm":
    "هل تريد حذف سجل وقود {vehicle} بتاريخ {date} ({volume}، {cost})؟ لا يمكن التراجع عن هذا الإجراء.",
  "fuel.thisVehicle": "هذه المركبة",
  "fuel.deleteFailed": "فشل الحذف",
};
