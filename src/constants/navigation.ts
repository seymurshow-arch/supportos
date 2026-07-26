import {
  BarChart3,
  Bot,
  CalendarDays,
  Gauge,
  LayoutDashboard,
  Settings,
  TimerReset,
  WalletCards,
} from "lucide-react";

export const navigation = [
  {
    title: "Command",
    items: [{ name: "Command Center", href: "/", icon: LayoutDashboard }],
  },
  {
    title: "Analytics",
    items: [{ name: "Reports", href: "/reports", icon: BarChart3 }],
  },
  {
    title: "Operations",
    items: [
      { name: "Schedule", href: "/schedule", icon: CalendarDays },
      { name: "Agent Breaks", href: "/agent-breaks", icon: TimerReset },
      { name: "KPI & Salary", href: "/kpi-salary", icon: WalletCards },
    ],
  },
  {
    title: "AI",
    items: [{ name: "AI Issues", href: "/ai-issues", icon: Bot }],
  },
  {
    title: "System",
    items: [{ name: "Settings", href: "/settings", icon: Settings }],
  },
];