import {
  BarChart3,
  Bot,
  CalendarDays,
  Link2,
  WalletCards,
  LockKeyhole,
  BookOpenCheck,
} from "lucide-react";

export const navigation = [
  {
    title: "SportBet Support",
    items: [
      { name: "AI Analytics", href: "/ai-analytics", icon: Bot },
      { name: "Knowledge / QA", href: "/knowledge", icon: BookOpenCheck },
      { name: "Reports", href: "/reports", icon: BarChart3 },
      { name: "Schedule", href: "/schedule", icon: CalendarDays },
      { name: "Agent Mapping", href: "/agent-mapping", icon: Link2 },
      { name: "KPI & Salary", href: "/kpi-salary", icon: WalletCards },
      { name: "Agent Information", href: "/agent-information", icon: LockKeyhole },
    ],
  },
];
