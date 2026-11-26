"use client";

import { useId } from "react";
import { useRouter } from "next/navigation";
import { filterLabelClass, filterSelectClass } from "./filterStyles";

export function PublicWishlistCategoryFilter({ actionPath, query, category, categories }: {
  actionPath: string; query: string; category: string;
  categories: Array<{ value: string; label: string; count: number }>;
}) {
  const id = useId(), router = useRouter();
  const unavailable = Boolean(category && category !== "all" && !categories.some(option => option.value === category));
  return <div className="inventory-filter-trigger">
    <label htmlFor={id} className={filterLabelClass}>Category</label>
    <select id={id} aria-label="Wishlist category" className={filterSelectClass} value={category === "all" ? "" : category}
      onChange={event => { const params = new URLSearchParams(query); params.delete("page");
        if (event.target.value) params.set("category", event.target.value); else params.delete("category");
        router.push(`${actionPath}?${params}`); }}>
      <option value="">All shared wishes</option>
      {unavailable ? <option value={category} disabled>Unavailable category</option> : null}
      {categories.map(option => <option key={option.value} value={option.value}>{option.label} ({option.count})</option>)}
    </select>
  </div>;
}
