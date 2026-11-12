"use client";

import { useLayoutEffect, useRef } from "react";

function formValues(node: HTMLElement | null) {
  return JSON.stringify(
    Array.from(node?.querySelectorAll("form") ?? []).map((form) =>
      Array.from(new FormData(form).entries())
        .filter(([name]) => !name.startsWith("$ACTION_"))
        .map(([name, value]) => [
          name,
          typeof value === "string"
            ? value
            : [value.name, value.size, value.lastModified],
        ]),
    ),
  );
}

/** Keep draft comparisons tied to the persisted row and the visible editing task. */
export function useFormDiscardGuard(contextKey: string) {
  const ref = useRef<HTMLDivElement>(null);
  const saved = useRef<string | null>(null);
  useLayoutEffect(() => {
    saved.current = formValues(ref.current);
  }, [contextKey]);
  function canDiscard() {
    return (
      saved.current === null ||
      saved.current === formValues(ref.current) ||
      window.confirm("Discard unsaved card changes?")
    );
  }
  function afterReset() {
    queueMicrotask(() => {
      saved.current = formValues(ref.current);
    });
  }
  return { ref, canDiscard, afterReset };
}
