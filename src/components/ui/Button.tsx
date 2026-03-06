import { type ButtonHTMLAttributes, forwardRef } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger" | "tab";
  size?: "sm" | "md" | "lg" | "icon";
  isActive?: boolean;
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className = "", variant = "primary", size = "md", isActive, ...props }, ref) => {
    const baseStyles = "inline-flex items-center justify-center font-medium transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none rounded-sm";
    
    const variants = {
      primary: "bg-mantle hover:bg-surface0 border border-surface0 text-text",
      secondary: "bg-surface0 hover:bg-surface1 border border-surface1 text-text",
      ghost: "text-subtext1 hover:text-text hover:bg-surface0/30",
      danger: "text-red hover:bg-red/10",
      tab: isActive 
        ? "bg-surface0 text-text" 
        : "text-subtext1 hover:text-text hover:bg-surface0/30",
    };

    const sizes = {
      sm: "px-2 py-1 text-[11px]",
      md: "px-3 py-1.5 text-sm",
      lg: "px-4 py-2 text-base",
      icon: "p-1.5",
    };

    const combinedClassName = `${baseStyles} ${variants[variant]} ${sizes[size]} ${className}`;

    return (
      <button
        ref={ref}
        className={combinedClassName}
        {...props}
      />
    );
  }
);

Button.displayName = "Button";

export { Button };
