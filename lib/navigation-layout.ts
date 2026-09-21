export type NavigationLayout = "sidebar" | "topbar";

export function normalizeNavigationLayout(value: unknown): NavigationLayout {
  return value === "topbar" ? "topbar" : "sidebar";
}
