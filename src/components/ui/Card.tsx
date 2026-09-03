import { ReactNode } from "react";

type CardProps = {
  children: ReactNode;
  className?: string;
};

export default function Card({ children, className = "" }: CardProps) {
  return (
    <div className={`rounded-2xl border border-[#263a56]/80 bg-gradient-to-b from-[#111f34] to-[#0b182a] shadow-[0_18px_55px_rgba(0,0,0,0.2)] ${className}`}>
      {children}
    </div>
  );
}
