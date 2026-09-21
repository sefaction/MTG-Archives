"use client";

import { useActionState, useRef, useState } from "react";
import {
  defaultStorageLayout,
  validateStorageLayout,
  type StorageLayout,
} from "@/lib/storage-layout";
import { NewLocationParentFields } from "./LocationSearchSelect";
import { StorageLayoutFields } from "./StorageLayoutFields";
import {
  cn,
  filterButtonClass,
  filterInputClass,
  filterPrimaryButtonClass,
  filterSelectClass,
} from "./filterStyles";

export function LocationCreateWizard({
  action,
  types,
  owners,
  defaultOwnerId,
  defaultParentId,
  locations,
}: {
  action: (
    state: { error: string },
    fd: FormData,
  ) => Promise<{ error: string }>;
  types: { name: string; layout: StorageLayout }[];
  owners?: { id: string; name: string }[];
  defaultOwnerId: string;
  defaultParentId: string;
  locations: { id: string; name: string; ownerPlayerId: string }[];
}) {
  const [state, formAction, pending] = useActionState(action, { error: "" });
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [type, setType] = useState("");
  const [newType, setNewType] = useState("");
  const [layout, setLayout] = useState<StorageLayout>(defaultStorageLayout());
  const [layoutVersion, setLayoutVersion] = useState(0);
  const [error, setError] = useState("");
  const [placement, setPlacement] = useState("");
  const form = useRef<HTMLFormElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  function go(next: number) {
    setStep(next);
    setError("");
    requestAnimationFrame(() => heading.current?.focus());
  }
  function next() {
    const fields = form.current?.querySelectorAll<
      HTMLInputElement | HTMLSelectElement
    >(`[data-step="${step}"] input, [data-step="${step}"] select`);
    if (fields && [...fields].some((field) => !field.reportValidity())) return;
    if (step === 1) {
      const mode = new FormData(form.current!).get("storageMode");
      if (mode === "sections" && !layout.sections.length) {
        setError(
          "Generate at least one section, or choose no capacity tracking.",
        );
        return;
      }
      try {
        validateStorageLayout(layout);
      } catch (error) {
        setError((error as Error).message);
        return;
      }
      const fd = new FormData(form.current!);
      const owner = owners?.find(
        (owner) => owner.id === fd.get("ownerPlayerId"),
      );
      const parent = locations.find(
        (location) => location.id === fd.get("parentLocationId"),
      );
      setPlacement(
        `${owner ? owner.name + " · " : ""}${parent?.name ?? "Top level"}`,
      );
    }
    go(step + 1);
  }
  return (
    <form
      aria-label="Create location"
      ref={form}
      action={formAction}
      className="space-y-4"
      onSubmit={(event) => {
        if (step !== 2) {
          event.preventDefault();
          next();
        }
      }}
    >
      <ol
        className="flex flex-wrap gap-3 text-sm"
        aria-label="Create location steps"
      >
        {["Basics", "Storage", "Review"].map((label, index) => (
          <li
            key={label}
            aria-current={step === index ? "step" : undefined}
            className={
              step === index
                ? "font-semibold text-[var(--app-link)]"
                : "text-[var(--app-muted)]"
            }
          >
            {index + 1}. {label}
          </li>
        ))}
      </ol>
      <h3 ref={heading} tabIndex={-1} className="text-lg font-semibold">
        {
          ["Name your location", "How is it organized?", "Ready to create"][
            step
          ]
        }
      </h3>
      <fieldset
        hidden={step !== 0}
        style={{ display: step === 0 ? undefined : "none" }}
        data-step="0"
        className="grid gap-3 md:grid-cols-2"
      >
        <label className="text-sm">
          Name
          <input
            name="name"
            required
            maxLength={150}
            value={name}
            onChange={(event) => setName(event.target.value)}
            className={cn(filterInputClass, "mt-1 w-full")}
            placeholder="Box-0001"
          />
        </label>
        <label className="text-sm">
          Location type
          <select
            name="type"
            aria-label="Location type"
            value={type}
            onChange={(event) => {
              setType(event.target.value);
              setNewType("");
              setLayout(
                types.find((type) => type.name === event.target.value)
                  ?.layout ?? defaultStorageLayout(event.target.value),
              );
              setLayoutVersion((value) => value + 1);
            }}
            className={cn(filterSelectClass, "mt-1 w-full")}
          >
            <option value="">No type</option>
            {types.map((type) => (
              <option key={type.name}>{type.name}</option>
            ))}
          </select>
        </label>
        <NewLocationParentFields
          owners={owners}
          defaultOwnerId={defaultOwnerId}
          defaultParentId={defaultParentId}
          locations={locations}
        />
        <details className="md:col-span-2">
          <summary className="cursor-pointer py-2 text-sm">
            New type, description and visibility
          </summary>
          <div className="mt-2 grid gap-3 md:grid-cols-2">
            <label className="text-sm">
              New location type
              <input
                name="newType"
                maxLength={100}
                value={newType}
                onChange={(event) => {
                  setNewType(event.target.value);
                  setType("");
                }}
                className={cn(filterInputClass, "mt-1 w-full")}
              />
            </label>
            <label className="text-sm">
              Description
              <input
                name="description"
                className={cn(filterInputClass, "mt-1 w-full")}
              />
            </label>
            <label className="text-sm">
              Visibility
              <select
                name="visibility"
                defaultValue="INHERIT"
                className={cn(filterSelectClass, "mt-1 w-full")}
              >
                <option value="INHERIT">Use account default</option>
                <option value="PRIVATE">Private</option>
                <option value="PUBLIC">Public</option>
              </select>
            </label>
          </div>
        </details>
      </fieldset>
      <fieldset
        hidden={step !== 1}
        style={{ display: step === 1 ? undefined : "none" }}
        data-step="1"
      >
        <p className="mb-3 text-sm text-[var(--app-muted)]">
          {newType
            ? "This layout will also be the starting default for your new type."
            : type
              ? `Starting with ${type} defaults. Customize this location without changing the type.`
              : "Capacity and sections are optional."}
        </p>
        <StorageLayoutFields
          key={layoutVersion}
          value={layout}
          onChange={setLayout}
        />
      </fieldset>
      {step === 2 && (
        <div className="space-y-2 rounded-lg border border-[var(--app-border)] p-4 text-sm">
          <p className="text-lg font-semibold">{name}</p>
          <p>
            {newType || type || "No type"} · {placement}
          </p>
          <p>
            {layout.capacity === null
              ? "No overall capacity"
              : `${layout.capacity.toLocaleString()} cards overall`}{" "}
            · {layout.sections.length} default sections
          </p>
          <ul className="max-h-48 overflow-y-auto">
            {layout.sections.map((section, index) => (
              <li key={index}>
                {section.name}:{" "}
                {section.capacity === null
                  ? "capacity not set"
                  : `${section.capacity.toLocaleString()} cards`}
              </li>
            ))}
          </ul>
          <p>All capacities are advisory. No existing cards will be changed.</p>
        </div>
      )}
      {(error || state.error) && (
        <p role="alert" className="rounded border border-amber-600 p-3 text-sm">
          {error || state.error}
        </p>
      )}
      <div className="flex gap-2">
        {step > 0 && (
          <button
            type="button"
            disabled={pending}
            className={filterButtonClass}
            onClick={() => go(step - 1)}
          >
            Back
          </button>
        )}
        {step < 2 ? (
          <button
            key="continue"
            type="button"
            className={filterPrimaryButtonClass}
            onClick={(event) => {
              event.preventDefault();
              next();
            }}
          >
            Continue
          </button>
        ) : (
          <button
            key="create"
            type="submit"
            disabled={pending}
            className={filterPrimaryButtonClass}
          >
            {pending ? "Creating location…" : "Create Location"}
          </button>
        )}
      </div>
    </form>
  );
}
