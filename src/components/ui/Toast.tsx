"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Icon from "./Icon";

export interface ToastState {
  type: "success" | "error";
  text: string;
}

/** Holds one toast at a time and clears its timer on replace and unmount. */
export function useToast(duration = 3500) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const dismiss = useCallback(() => {
    clearTimeout(timer.current);
    setToast(null);
  }, []);

  const show = useCallback(
    (type: ToastState["type"], text: string) => {
      clearTimeout(timer.current);
      setToast({ type, text });
      timer.current = setTimeout(() => setToast(null), duration);
    },
    [duration]
  );

  useEffect(() => () => clearTimeout(timer.current), []);

  return { toast, show, dismiss };
}

export default function Toast({ toast, onDismiss }: { toast: ToastState | null; onDismiss: () => void }) {
  if (!toast) return null;
  return (
    <div className={`toast toast--${toast.type}`} role={toast.type === "error" ? "alert" : "status"}>
      <Icon name={toast.type === "error" ? "alert" : "checkCircle"} size={18} />
      <span>{toast.text}</span>
      <button type="button" className="toast-close" onClick={onDismiss} aria-label="Dismiss notification">
        <Icon name="close" size={16} />
      </button>
    </div>
  );
}
