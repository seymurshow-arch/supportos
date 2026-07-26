import { ReactNode } from "react";

type CardProps = {
  children: ReactNode;
  className?: string;
};

export default function Card({ children, className = "" }: CardProps) {
  return (
    <div
      className={`rounded-3xl border border-white/10 bg-white/[0.035] shadow-[0_20px_80px_rgba(0,0,0,0.25)] ${className}`}
    >
      {children}
    </div>
  );
}