import { enDashboard } from "../en/dashboard";

export const arDashboard: Record<keyof typeof enDashboard, string> = {
  "dashboard.subtitle": "صحة الأسطول والإنفاق والأعمال القادمة في لمحة",

  // KPI cards
  "dashboard.totalVehicles": "إجمالي المركبات",
  "dashboard.nActive": "{count} نشطة",
  "dashboard.openIssues": "الأعطال المفتوحة",
  "dashboard.openWorkOrders": "أوامر العمل المفتوحة",
  "dashboard.attentionNeeded": "يتطلب الانتباه",
  "dashboard.attentionSub": "عناصر متأخرة تتطلب إجراءً",

  // Charts
  "dashboard.monthlySpend": "الإنفاق الشهري — آخر 6 أشهر",
  "dashboard.fleetStatus": "حالة الأسطول",
  "dashboard.vehiclesLabel": "مركبة",

  // Due-soon lists
  "dashboard.dueSoonService": "قريبة الاستحقاق — الصيانة",
  "dashboard.dueSoonRenewals": "قريبة الاستحقاق — التجديدات",
  "dashboard.slCertsTitle": "شهادات محددات السرعة — على وشك الانتهاء",
  "dashboard.nothingDue": "لا شيء مستحق — أسطول بحالة جيدة.",

  // Badges
  "dashboard.overdue": "متأخر",
  "dashboard.expired": "منتهية",
  "dashboard.dueSoon": "قريبة الاستحقاق",
  "dashboard.dueToday": "مستحقة اليوم",
  "dashboard.dueInDays": "خلال {count} يوم",
};
