"use client";

import { useId, type ReactNode } from "react";
import Icon from "./Icon";

interface ControlProps {
  id: string;
  "aria-invalid": boolean | undefined;
  "aria-describedby": string | undefined;
}

interface FieldProps {
  label: string;
  error?: string;
  hint?: string;
  optional?: boolean;
  full?: boolean;
  children: (control: ControlProps) => ReactNode;
}

/** Label, control, hint and error message wired together for assistive tech. */
export default function Field({ label, error, hint, optional, full, children }: FieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(" ");

  return (
    <div className={`field ${full ? "field--full" : ""}`.trim()}>
      <label className="label" htmlFor={id}>
        {label}
        {optional ? <span className="label-optional">Optional</span> : null}
      </label>
      {children({
        id,
        "aria-invalid": error ? true : undefined,
        "aria-describedby": describedBy || undefined,
      })}
      {hint && !error ? (
        <p className="field-hint" id={hintId}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p className="field-error" id={errorId}>
          <Icon name="alert" size={14} />
          {error}
        </p>
      ) : null}
    </div>
  );
}
