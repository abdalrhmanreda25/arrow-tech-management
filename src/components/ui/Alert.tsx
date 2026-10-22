import type { ReactNode } from "react";
import Icon from "./Icon";

export type FormStatus = { type: "success" | "error"; text: string } | null;

interface AlertProps {
  type: "success" | "error";
  children: ReactNode;
  className?: string;
}

/** Inline feedback message. Errors interrupt assistive tech, successes are announced politely. */
export default function Alert({ type, children, className = "" }: AlertProps) {
  return (
    <div
      className={`alert alert--${type} ${className}`.trim()}
      role={type === "error" ? "alert" : "status"}
    >
      <Icon name={type === "error" ? "alert" : "checkCircle"} size={18} />
      <div className="alert-body">{children}</div>
    </div>
  );
}
