"use client";

import { useFormStatus } from "react-dom";
import { LoadingSpinner } from "./LoadingSpinner";

type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  pendingLabel: string;
  children: React.ReactNode;
  minWidthClassName?: string;
};

export function SubmitButton({
  pendingLabel,
  children,
  className = "",
  minWidthClassName = "min-w-28",
  disabled,
  ...props
}: Props) {
  const { pending } = useFormStatus();
  return (
    <button
      {...props}
      disabled={disabled || pending}
      aria-disabled={disabled || pending}
      className={`${minWidthClassName} ${className} disabled:cursor-not-allowed disabled:opacity-60`}
    >
      <span className="inline-flex items-center justify-center gap-2">
        {pending ? <LoadingSpinner /> : null}
        {pending ? pendingLabel : children}
      </span>
    </button>
  );
}
