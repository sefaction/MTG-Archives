import type { ReactNode } from "react";
import { cn, filterButtonClass } from "./filterStyles";

const tasks = [
  { id: "scan", label: "Scan cards", href: "/imports/scan?input=scanner" },
  { id: "camera", label: "Camera", href: "/imports/scan?input=camera" },
  { id: "photos", label: "Upload photos", href: "/imports/scan?input=photos" },
  { id: "csv", label: "Import CSV", href: "/imports?view=csv" },
  { id: "add", label: "Add card", href: "/imports?view=add" },
  { id: "export", label: "Export", href: "/imports?view=export" },
  { id: "history", label: "History", href: "/imports?view=history" },
];

export function ImportTaskNav({ selected, children }: { selected: string; children?: ReactNode }) {
  return (
    <nav aria-label="Import tasks" className="flex flex-wrap gap-2">
      {tasks.map(({ id, label, href }) => (
        <a key={id} href={href} aria-current={selected === id ? "page" : undefined}
          className={cn(filterButtonClass, selected === id && "border-[var(--app-accent)] bg-[var(--app-accent-soft)]")}>
          {label}
        </a>
      ))}
      {children}
    </nav>
  );
}
