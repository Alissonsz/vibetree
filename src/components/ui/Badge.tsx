import { type ReactNode } from "react";

interface BadgeProps {
  children: ReactNode;
  variant?: "default" | "green" | "red" | "blue" | "yellow";
  className?: string;
}

const Badge = ({ children, variant = "default", className = "" }: BadgeProps) => {
  const baseStyles = "text-[10px] font-mono font-bold w-3 h-3 flex items-center justify-center";
  
  const variants = {
    default: "text-text",
    green: "text-green",
    red: "text-red",
    blue: "text-blue",
    yellow: "text-yellow",
  };

  return (
    <span className={`${baseStyles} ${variants[variant]} ${className}`}>
      {children}
    </span>
  );
};

export { Badge };
