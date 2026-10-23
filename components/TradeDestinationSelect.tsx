import React from "react";
import { cn, filterSelectClass } from "./filterStyles";

export function TradeDestinationSelect({
  incomingLineCount,
  locations,
}: {
  incomingLineCount: number;
  locations: { id: string; path: string }[];
}) {
  return (
    <label className="min-w-0 w-full text-sm text-zinc-300 sm:min-w-64 sm:w-auto">
      Move {incomingLineCount} incoming card{" "}
      {incomingLineCount === 1 ? "line" : "lines"} to
      <select
        name="destinationLocationId"
        required
        defaultValue=""
        className={cn(filterSelectClass, "mt-1 w-full")}
      >
        <option value="" disabled>
          Choose a destination location
        </option>
        {locations.map((location) => (
          <option key={location.id} value={location.id}>
            {location.path}
          </option>
        ))}
      </select>
    </label>
  );
}
