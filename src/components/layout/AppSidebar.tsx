"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity } from "lucide-react";
import { navigation } from "@/constants/navigation";

export default function AppSidebar() {
  const pathname = usePathname();

  return (
    <aside className="fixed left-0 top-0 z-40 hidden h-screen w-[280px] border-r border-white/10 bg-[#080B12]/95 px-4 py-5 text-white lg:block">
      <div className="mb-8 rounded-2xl border border-cyan-400/20 bg-cyan-400/5 p-4">
        <div className="text-lg font-bold tracking-tight">SupportOS</div>
        <div className="mt-1 text-xs text-cyan-300">Command Platform v2</div>
      </div>

      <nav className="space-y-6">
        {navigation.map((group) => (
          <div key={group.title}>
            <div className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/35">
              {group.title}
            </div>

            <div className="space-y-1">
              {group.items.map((item) => {
                const Icon = item.icon;
                const active = pathname === item.href;

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition ${
                      active
                        ? "bg-cyan-400/10 text-cyan-200 ring-1 ring-cyan-400/25"
                        : "text-white/60 hover:bg-white/5 hover:text-white"
                    }`}
                  >
                    <Icon size={18} />
                    <span>{item.name}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="absolute bottom-5 left-4 right-4 rounded-2xl border border-emerald-400/20 bg-emerald-400/5 p-4">
        <div className="flex items-center gap-2 text-sm text-emerald-300">
          <Activity size={16} />
          LiveChat Ready
        </div>
        <div className="mt-1 text-xs text-white/40">Engine not connected yet</div>
      </div>
    </aside>
  );
}