import { ReactNode } from "react";

type StatCardProps = {
  title: string;
  value: string | number;
  subtitle?: string;
  icon?: ReactNode;
};

export default function StatCard({
  title,
  value,
  subtitle,
  icon,
}: StatCardProps) {
  return (
    <div className="rounded-3xl border border-white/10 bg-white/[0.035] p-6 shadow-[0_20px_60px_rgba(0,0,0,0.25)] transition hover:border-cyan-400/30 hover:bg-white/[0.05]">
      <div className="flex items-center justify-between">
        <span className="text-sm text-white/55">
          {title}
        </span>

        {icon}
      </div>

      <div className="mt-5 text-4xl font-bold tracking-tight">
        {value}
      </div>

      {subtitle && (
        <div className="mt-2 text-sm text-white/40">
          {subtitle}
        </div>
      )}
    </div>
  );
}