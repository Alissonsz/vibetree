import { useEffect, useState } from "react";

export function useWindowFocus(): boolean {
  const [windowFocused, setWindowFocused] = useState<boolean>(() => document.hasFocus());

  useEffect(() => {
    const handleFocus = () => setWindowFocused(true);
    const handleBlur = () => setWindowFocused(false);

    window.addEventListener("focus", handleFocus);
    window.addEventListener("blur", handleBlur);

    return () => {
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("blur", handleBlur);
    };
  }, []);

  return windowFocused;
}
