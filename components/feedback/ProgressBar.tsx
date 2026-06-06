export function ProgressBar({
  value,
  max,
  label,
}: {
  value: number;
  max: number;
  label: string;
}) {
  const safeMax = Math.max(max, 0);
  const safeValue = Math.min(Math.max(value, 0), safeMax);
  const percent = safeMax > 0 ? Math.round((safeValue / safeMax) * 100) : 0;
  return (
    <div className="space-y-1" aria-live="polite">
      <div className="flex justify-between text-xs text-zinc-400">
        <span>{label}</span>
        <span>{safeMax > 0 ? `${percent}%` : "Preparing…"}</span>
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={safeMax || undefined}
        aria-valuenow={safeMax ? safeValue : undefined}
        className="h-2 overflow-hidden rounded bg-zinc-800"
      >
        <div
          className="h-full bg-sky-500 transition-all"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
