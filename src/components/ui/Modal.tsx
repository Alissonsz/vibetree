import { type ReactNode } from "react";
import { X } from "lucide-react";
import { Button } from "./Button";

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  maxWidth?: string;
  className?: string;
}

const Modal = ({
  isOpen,
  onClose,
  title,
  children,
  footer,
  maxWidth = "max-w-5xl",
  className = "",
}: ModalProps) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 md:p-8 bg-crust/80 backdrop-blur-sm">
      <div className={`flex flex-col w-full h-full ${maxWidth} bg-base rounded-sm border border-surface0 shadow-2xl overflow-hidden ${className}`}>
        <div className="flex items-center justify-between p-4 border-b border-surface0 bg-mantle shrink-0">
          <div className="flex items-center gap-6">
            <span className="text-sm font-medium text-text">{title}</span>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close modal">
            <X size={16} />
          </Button>
        </div>
        <div className="flex-1 overflow-auto bg-base p-4">
          {children}
        </div>
        {footer && (
          <div className="p-4 border-t border-surface0 bg-mantle shrink-0">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
};

export { Modal };
