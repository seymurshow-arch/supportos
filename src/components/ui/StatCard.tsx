import { ReactNode } from "react";

type StatCardProps = { title: string; value: string | number; subtitle?: string; icon?: ReactNode };

export default function StatCard({ title, value, subtitle, icon }: StatCardProps) {
  return (
    <div className="rounded-2xl border border-[#263a56]/80 bg-gradient-to-b from-[#111f34] to-[#0c192b] p-6 shadow-[0_18px_50px_rgba(0,0,0,0.18)] transition hover:-translate-y-0.5 hover:border-sb-green/25">
      <div className="flex items-center justify-between">
        <span className="text-sm text-[#91a3ba]">{title}</span>
        <span className="text-sb-green">{icon}</span>
      </div>
      <div className="mt-5 text-4xl font-bold tracking-tight text-white">{value}</div>
      {subtitle ? <div className="mt-2 text-sm text-[#6f829c]">{subtitle}</div> : null}
    </div>
  );
}
