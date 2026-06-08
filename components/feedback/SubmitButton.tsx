"use client";

import { useFormStatus } from "react-dom";
import { LoadingSpinner } from "./LoadingSpinner";

type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  pendingLabel: string;
  children: React.ReactNode;
  minWidthClassName?: string;
  confirmMessage?: string;
};

export function SubmitButton({
  pendingLabel,
  children,
  className = "",
  minWidthClassName = "min-w-28",
  disabled,
  confirmMessage,
  onClick,
  ...props
}: Props) {
  const { pending } = useFormStatus();
  return (
    <button
      {...props}
      disabled={disabled || pending}
      aria-disabled={disabled || pending}
      className={`${minWidthClassName} ${className} disabled:cursor-not-allowed disabled:opacity-60`}
      onClick={(event) => {
        if (confirmMessage && !window.confirm(confirmMessage)) {
          event.preventDefault();
          return;
        }
        onClick?.(event);
      }}
    >
      <span className="inline-flex items-center justify-center gap-2">
        {pending ? <LoadingSpinner /> : null}
        {pending ? pendingLabel : children}
      </span>
    </button>
  );
}
