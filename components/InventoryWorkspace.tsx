"use client";

import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { CollapsiblePanel } from "./CollapsiblePanel";
import { filterButtonClass } from "./filterStyles";

const STORAGE_KEY = "mtg-inventory-advanced-search-open";
const WorkspaceContext = createContext<{
  cardName: string;
  setCardName: (value: string) => void;
} | null>(null);

export const useInventoryWorkspace = () => useContext(WorkspaceContext);

export function InventoryViewOptions({ children }: { children: ReactNode }) {
  const workspace = useInventoryWorkspace();
  return workspace ? (
    <details className="inventory-view-options">
      <summary className={filterButtonClass}>View options</summary>
      <div className="flex flex-wrap items-center gap-2 pt-2">{children}</div>
    </details>
  ) : (
    <div className="contents">{children}</div>
  );
}

export function InventoryWorkspace({
  cardName,
  children,
}: {
  cardName: string;
  children: ReactNode;
}) {
  const [draft, setDraft] = useState({ applied: cardName, value: cardName });
  // Reset with the new server search before children commit, rather than
  // scheduling a later effect that could overwrite a newly typed draft.
  if (draft.applied !== cardName)
    setDraft({ applied: cardName, value: cardName });
  return (
    <WorkspaceContext.Provider
      value={{
        cardName: draft.value,
        setCardName: (value) => setDraft((current) => ({ ...current, value })),
      }}
    >
      <div className="inventory-workspace">{children}</div>
    </WorkspaceContext.Provider>
  );
}

export function InventoryFilterContainer(props: {
  title: string;
  defaultOpen?: boolean;
  summary?: ReactNode;
  storageKey?: string;
  error?: string;
  navigation?: ReactNode;
  children: ReactNode;
}) {
  const workspace = useInventoryWorkspace();
  const inWorkspace = Boolean(workspace);
  const defaultOpen = Boolean(props.defaultOpen);
  const [open, setOpen] = useState(false);
  const [mobile, setMobile] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();

  useEffect(() => {
    if (!inWorkspace) return;
    const query = window.matchMedia("(max-width: 899px)");
    const resize = () => setMobile(query.matches);
    const frame = requestAnimationFrame(() => {
      resize();
      setOpen(
        defaultOpen ||
          (!query.matches && sessionStorage.getItem(STORAGE_KEY) === "open"),
      );
    });
    query.addEventListener("change", resize);
    return () => {
      cancelAnimationFrame(frame);
      query.removeEventListener("change", resize);
    };
  }, [inWorkspace, defaultOpen]);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (element.open) element.close();
    if (open) {
      if (mobile) element.showModal();
      else element.show();
    }
  }, [open, mobile]);

  useEffect(() => {
    const element = dialog.current;
    if (!element || !open || mobile) return;
    const fit = () => {
      const top = Math.max(12, element.getBoundingClientRect().top);
      element.style.maxHeight = `${Math.max(200, innerHeight - top - 12)}px`;
    };
    const frame = requestAnimationFrame(fit);
    window.addEventListener("resize", fit);
    window.addEventListener("scroll", fit, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", fit);
      window.removeEventListener("scroll", fit);
      element.style.removeProperty("max-height");
    };
  }, [open, mobile]);

  function close() {
    dialog.current?.close();
    setOpen(false);
    sessionStorage.setItem(STORAGE_KEY, "closed");
    trigger.current?.focus();
  }

  if (!workspace) return <CollapsiblePanel {...props} />;
  return (
    <>
      <div className="inventory-filter-trigger">
        <button
          ref={trigger}
          type="button"
          className={filterButtonClass}
          aria-label="Filters — Advanced Inventory Search"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => {
            if (open) close();
            else {
              setOpen(true);
              sessionStorage.setItem(STORAGE_KEY, "open");
            }
          }}
        >
          Filters {open ? "−" : "+"}
        </button>
        <span>{props.summary}</span>
      </div>
      <dialog
        ref={dialog}
        id={id}
        className="inventory-filter-panel"
        aria-labelledby={`${id}-title`}
        onCancel={(event) => {
          event.preventDefault();
          close();
        }}
      >
        <div className="inventory-filter-heading">
          <div className="inventory-filter-heading-row">
            <h2 id={`${id}-title`}>Filter inventory</h2>
            <button type="button" className={filterButtonClass} onClick={close}>
              Close filters
            </button>
          </div>
          {props.navigation}
        </div>
        {props.error && (
          <p
            role="alert"
            className="mb-3 rounded border border-red-700 bg-red-950 p-2 text-sm text-red-100"
          >
            {props.error}
          </p>
        )}
        {props.children}
      </dialog>
    </>
  );
}
