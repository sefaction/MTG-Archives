"use client";

import { useLayoutEffect, useRef, type RefObject } from "react";

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
export function useFormDiscardGuard(
  ref: RefObject<HTMLDivElement | null>,
  contextKey: string,
) {
  const saved = useRef<string | null>(null);
  useLayoutEffect(() => {
    saved.current = formValues(ref.current);
  }, [ref, contextKey]);
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
  return { canDiscard, afterReset };
}
