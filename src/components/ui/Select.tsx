import { useState, useRef, useEffect, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Check } from "lucide-react";

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}

export function Select({
  value,
  onChange,
  options,
  disabled = false,
  placeholder = "Select an option",
  className = "",
}: SelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const selectedOption = options.find((opt) => opt.value === value);

  useLayoutEffect(() => {
    if (isOpen && containerRef.current) {
      setRect(containerRef.current.getBoundingClientRect());
    }
  }, [isOpen]);

  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node) &&
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    const handleScroll = () => {
      if (isOpen && containerRef.current) {
        setRect(containerRef.current.getBoundingClientRect());
      }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleOutsideClick);
      window.addEventListener("scroll", handleScroll, true);
      window.addEventListener("resize", handleScroll);
    }

    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
      window.removeEventListener("scroll", handleScroll, true);
      window.removeEventListener("resize", handleScroll);
    };
  }, [isOpen]);

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setIsOpen(!isOpen)}
        className={`w-full flex items-center justify-between bg-mantle border border-surface0 rounded-sm px-3 h-[38px] text-sm text-text focus:outline-none focus:border-surface1 transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
          isOpen ? "border-surface1" : ""
        }`}
      >
        <span className={`truncate ${!selectedOption ? "text-surface2 italic" : "text-text"}`}>
          {selectedOption ? selectedOption.label : placeholder}
        </span>
        <ChevronDown size={14} className="text-subtext1 shrink-0 ml-2" />
      </button>

      {isOpen && rect && createPortal(
        <div 
          ref={dropdownRef}
          className="fixed z-[9999] bg-mantle border border-surface0 rounded-sm shadow-xl max-h-60 overflow-y-auto py-1"
          style={{
            top: rect.bottom + 4,
            left: rect.left,
            width: rect.width,
          }}
        >
          {options.length === 0 ? (
            <div className="px-3 py-2 text-sm text-subtext1">No options available</div>
          ) : (
            options.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-surface0 transition-colors cursor-pointer text-left ${
                  value === option.value ? "text-blue bg-surface0/30" : "text-text"
                }`}
                onClick={() => {
                  onChange(option.value);
                  setIsOpen(false);
                }}
              >
                <span className="truncate pr-4">{option.label}</span>
                {value === option.value && <Check size={14} className="shrink-0" />}
              </button>
            ))
          )}
        </div>,
        document.body
      )}
    </div>
  );
}
