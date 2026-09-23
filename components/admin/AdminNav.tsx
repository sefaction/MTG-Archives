import Link from "next/link";

const tasks = [
  ["overview", "Overview", "/admin"],
  ["users", "Users", "/admin?view=users"],
  ["backups", "Backups", "/admin/backups"],
  ["metadata", "Card data", "/admin/metadata"],
  ["prices", "Pricing worker", "/admin/prices"],
  ["notifications", "Notifications", "/admin/notifications"],
  [
    "announcements",
    "Announcements",
    "/admin/notifications/trade-announcements",
  ],
] as const;
export function AdminNav({ active }: { active: (typeof tasks)[number][0] }) {
  return (
    <nav
      aria-label="Administration"
      className="flex flex-wrap gap-2 border-b border-[var(--app-border)] pb-3"
    >
      {tasks.map(([key, label, href]) => (
        <Link
          key={key}
          href={href}
          className="app-nav-link"
          aria-current={active === key ? "page" : undefined}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
