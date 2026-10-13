import { REQUEST_STEPS, requestStage, type RequestStage } from "@/lib/work-requests";

const TONE: Record<RequestStage["tone"], string> = {
  pending: "bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-300",
  progress: "bg-blue-100 text-blue-900 dark:bg-blue-950/60 dark:text-blue-300",
  action: "bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-300",
  good: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300",
  closed: "bg-ink-200 text-ink-700",
};

/**
 * One line that carries a client instruction from "Submitted" to the client's
 * decision — the request and the change order it became, as a single thread.
 * Shared by the portal and the staff page so both read the same story.
 */
export function RequestThread({
  status,
  co,
  audience,
}: {
  status: "REQUESTED" | "UNDER_REVIEW" | "CONVERTED" | "DECLINED" | "WITHDRAWN";
  co: { status: string } | null;
  audience: "client" | "staff";
}) {
  const stage = requestStage({ status }, co, audience);
  const ended = stage.tone === "closed";
  return (
    <div className="mt-2" role="group" aria-label={`Progress: ${stage.label}`}>
      <ol className="flex items-center gap-1" aria-hidden="true">
        {REQUEST_STEPS.map((name, i) => {
          const n = i + 1;
          const reached = n <= stage.step;
          return (
            <li key={name} className="flex min-w-0 flex-1 flex-col gap-1">
              <span
                className={`h-1.5 rounded-full ${
                  reached ? (ended && n === stage.step ? "bg-ink-400" : stage.tone === "good" ? "bg-emerald-600" : "bg-brand-500") : "bg-ink-200"
                }`}
              />
              <span className={`truncate text-[10px] ${reached ? "font-medium text-ink-700" : "text-ink-400"}`}>{name}</span>
            </li>
          );
        })}
      </ol>
      <p className={`mt-1.5 inline-block rounded-sm px-2 py-0.5 text-xs font-semibold ${TONE[stage.tone]}`}>{stage.label}</p>
    </div>
  );
}
