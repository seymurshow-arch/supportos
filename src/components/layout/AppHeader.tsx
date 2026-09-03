"use client";

import { usePathname } from "next/navigation";
import { Bell, CircleUserRound } from "lucide-react";
import { navigation } from "@/constants/navigation";

export default function AppHeader() {
  const pathname = usePathname();

  const current = navigation
    .flatMap((group) => group.items)
    .find((item) => item.href === pathname);

  const title =
    pathname === "/knowledge-assistant"
      ? "Knowledge Assistant"
      : current?.name ?? "Support Operations";

  return (
    <header className="sticky top-0 z-30 border-b border-[#20334d]/80 bg-[#07101d]/88 px-5 py-3.5 backdrop-blur-2xl lg:ml-[292px] lg:px-8">
      <div className="mx-auto flex max-w-[1680px] items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.24em] text-sb-green">
            <span className="h-1.5 w-1.5 rounded-full bg-sb-green" />
            SportBet Support
          </div>

          <h1 className="mt-1 truncate text-lg font-semibold tracking-tight text-white">
            {title}
          </h1>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label="Notifications"
            className="grid h-10 w-10 place-items-center rounded-xl border border-[#263b58] bg-[#0e1c30] text-[#8ea0b8] transition hover:border-sb-green/35 hover:text-white"
          >
            <Bell size={17} />
          </button>

          <div className="flex h-10 items-center gap-2 rounded-xl border border-[#263b58] bg-[#0e1c30] px-3 text-xs text-[#a9b7c9]">
            <CircleUserRound size={17} className="text-sb-green" />
            Admin
          </div>
        </div>
      </div>
    </header>
  );
}
