import { type ReactNode } from "react";

interface CardProps {
  children: ReactNode;
  variant?: "default" | "error" | "warning";
  className?: string;
}

const Card = ({ children, variant = "default", className = "" }: CardProps) => {
  const baseStyles = "p-3 rounded-sm text-sm";
  
  const variants = {
    default: "bg-surface0/30 text-text border border-surface0",
    error: "bg-red/10 text-red border border-red/20",
    warning: "bg-yellow/10 text-yellow border border-yellow/20",
  };

  return (
    <div className={`${baseStyles} ${variants[variant]} ${className}`}>
      {children}
    </div>
  );
};

export { Card };
