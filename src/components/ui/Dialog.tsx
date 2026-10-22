"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import Icon from "./Icon";

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: "md" | "lg" | "media";
  /** When false, Escape and backdrop clicks are ignored (for example while a request is running). */
  dismissible?: boolean;
}

/** Modal built on the native dialog element, which provides focus trapping and Escape handling. */
export default function Dialog({
  open,
  onClose,
  title,
  children,
  footer,
  size = "md",
  dismissible = true,
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const isMedia = size === "media";

  return (
    <dialog
      ref={ref}
      className={`dialog ${size === "md" ? "" : `dialog--${size}`}`.trim()}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        if (dismissible) onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current && dismissible) onClose();
      }}
    >
      {open ? (
        isMedia ? (
          <>
            <h2 id={titleId} className="sr-only">
              {title}
            </h2>
            <button type="button" className="icon-btn lightbox-close" onClick={onClose} aria-label="Close">
              <Icon name="close" size={18} />
            </button>
            {children}
          </>
        ) : (
          <>
            <div className="dialog-header">
              <h2 id={titleId} className="dialog-title">
                {title}
              </h2>
              <button
                type="button"
                className="icon-btn icon-btn--sm icon-btn--plain"
                onClick={onClose}
                disabled={!dismissible}
                aria-label="Close"
              >
                <Icon name="close" size={18} />
              </button>
            </div>
            <div className="dialog-body">{children}</div>
            {footer ? <div className="dialog-footer">{footer}</div> : null}
          </>
        )
      ) : null}
    </dialog>
  );
}
