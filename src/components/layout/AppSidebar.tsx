"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, Bot, ShieldCheck } from "lucide-react";
import { navigation } from "@/constants/navigation";

export default function AppSidebar() {
  const pathname = usePathname();

  const navigationWithKnowledgeAssistant = navigation.map((group) => ({
    ...group,
    items: group.items.flatMap((item) => {
      if (item.href === "/knowledge") {
        return [
          item,
          {
            name: "Knowledge Assistant",
            href: "/knowledge-assistant",
            icon: Bot,
          },
        ];
      }

      return [item];
    }),
  }));

  return (
    <aside className="fixed left-0 top-0 z-40 hidden h-screen w-[292px] border-r border-[#213550]/80 bg-[#091426]/95 text-white shadow-[24px_0_70px_rgba(0,0,0,0.18)] backdrop-blur-2xl lg:block">
      <div className="border-b border-[#213550]/70 px-5 py-5">
        <div className="overflow-hidden rounded-2xl border border-[#29405f]/80 bg-[#122139] px-4 py-3 shadow-[0_10px_35px_rgba(0,0,0,0.22)]">
          <Image
            src="/branding/sportbet-logo.png"
            alt="SportBet"
            width={1992}
            height={525}
            priority
            className="h-auto w-full"
          />
        </div>

        <div className="mt-3 flex items-center justify-between px-1">
          <span className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[#8194ae]">
            Support operations
          </span>

          <span className="h-2 w-2 rounded-full bg-sb-green shadow-[0_0_12px_rgba(117,242,150,0.75)]" />
        </div>
      </div>

      <nav className="px-4 py-5">
        {navigationWithKnowledgeAssistant.map((group) => (
          <div key={group.title}>
            <div className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.22em] text-[#61758f]">
              {group.title}
            </div>

            <div className="space-y-1.5">
              {group.items.map((item) => {
                const Icon = item.icon;
                const active = pathname === item.href;

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`group relative flex items-center gap-3 rounded-xl px-3.5 py-3 text-sm font-medium transition-all duration-200 ${
                      active
                        ? "bg-sb-green text-[#06130b] shadow-[0_10px_28px_rgba(117,242,150,0.14)]"
                        : "text-[#a9b7c9] hover:bg-[#13243b] hover:text-white"
                    }`}
                  >
                    {active ? (
                      <span className="absolute -left-4 h-7 w-1 rounded-r-full bg-sb-green" />
                    ) : null}

                    <Icon size={18} strokeWidth={active ? 2.3 : 1.8} />
                    <span>{item.name}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="absolute bottom-5 left-4 right-4 rounded-2xl border border-[#28415f] bg-[#101f34] p-4 shadow-[0_15px_35px_rgba(0,0,0,0.2)]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold text-white">
            <ShieldCheck size={16} className="text-sb-green" />
            SportBet workspace
          </div>

          <Activity size={15} className="text-sb-green" />
        </div>

        <div className="mt-2 flex items-center gap-2 text-xs text-[#7f92aa]">
          <span className="h-1.5 w-1.5 rounded-full bg-sb-green" />
          Preview mode · integrations later
        </div>
      </div>
    </aside>
  );
}
