import { Archivo } from "next/font/google";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { canAccess } from "@/lib/access";
import { php, phpCompact, fmtDateTime } from "@/lib/format";
import { getProjectFinances } from "@/lib/finance";
import {
  getBacklog,
  getBidPipeline,
  getCashRunway,
  getLatestCashSnapshot,
  getReceivablesAging,
  getRiskFlags,
  getWaterfall,
  getWipTable,
  type Waterfall,
} from "@/lib/finance-dashboard";
import { SetTargetMarginForm, UpdateCashForm } from "@/components/finance-actions";
import "./finance.css";

const archivo = Archivo({ subsets: ["latin"], weight: ["400", "500", "600", "700"] });

export const metadata = { title: "Finance" };
export const dynamic = "force-dynamic";

const AGING_COLORS: Record<string, string> = {
  "0–30 days": "#0B6E5A",
  "31–60 days": "#3D5A73",
  "61–90 days": "#B07514",
  "Over 90 days": "#A03426",
};

function waterfallBars(w: Waterfall) {
  const grossProfit = w.earnedRevenue - w.materials - w.labor;
  const netProfit = grossProfit - w.overhead;
  let running = w.earnedRevenue;
  const afterMaterials = running - w.materials;
  const afterLabor = afterMaterials - w.labor;
  const afterOverhead = afterLabor - w.overhead;
  const bars = [
    { label: "Earned revenue", top: w.earnedRevenue, bottom: 0 },
    { label: "Materials & subs", top: running, bottom: afterMaterials },
    { label: "Labor & payroll", top: afterMaterials, bottom: afterLabor },
    { label: "Gross profit", top: Math.max(afterLabor, 0), bottom: Math.min(afterLabor, 0) },
    { label: "Overhead", top: afterLabor, bottom: afterOverhead },
    { label: "Net profit", top: Math.max(afterOverhead, 0), bottom: Math.min(afterOverhead, 0) },
  ];
  const maxVal = Math.max(w.earnedRevenue, Math.abs(afterOverhead), 1);
  return { bars, maxVal, grossProfit, netProfit };
}

export default async function FinancePage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role === "CLIENT") redirect("/portal");
  if (!canAccess(user.role, user.department, "/finance")) redirect("/attendance"); // Owner-only

  const [cash, wip, waterfall, backlog, runway, aging, pipeline, flags, finances] = await Promise.all([
    getLatestCashSnapshot(),
    getWipTable(),
    getWaterfall(),
    getBacklog(),
    getCashRunway(),
    getReceivablesAging(),
    getBidPipeline(),
    getRiskFlags(),
    getProjectFinances(),
  ]);

  const totalReceivable = finances.reduce((s, f) => s + f.receivable, 0);
  const totalRetention = finances.reduce((s, f) => s + f.retentionHeld, 0);
  const netMarginPct = waterfall.earnedRevenue > 0 ? (waterfall.netProfit / waterfall.earnedRevenue) * 100 : 0;
  const asOf = fmtDateTime(new Date());
  const over90 = aging.buckets.find((b) => b.label === "Over 90 days");
  const maxAging = Math.max(...aging.buckets.map((b) => b.total), 1);
  const maxGap = Math.max(...wip.rows.map((r) => Math.abs(r.billingGap)), wip.totals ? Math.abs(wip.totals.billingGap) : 0, 1);
  const wf = waterfallBars(waterfall);
  const maxPipelineValue = Math.max(...pipeline.stages.map((s) => s.value), 1);

  const gapBar = (gap: number) => {
    const width = Math.min((Math.abs(gap) / maxGap) * 118, 118);
    return (
      <div className="gapwrap">
        <div className="gapaxis" />
        {gap !== 0 && (
          <>
            <div className={`gapbar ${gap >= 0 ? "over" : "under"}`} style={{ width: `${width}px` }} />
            <div
              className={`gapfig ${gap >= 0 ? "pos" : "neg"}`}
              style={gap >= 0 ? { left: `calc(50% + ${width + 8}px)` } : { right: `calc(50% + ${width + 8}px)` }}
            >
              {gap >= 0 ? "+" : "−"}
              {phpCompact(Math.abs(gap))}
            </div>
          </>
        )}
      </div>
    );
  };

  return (
    <div className={`findash ${archivo.className}`}>
      <div className="shell">
        <div className="masthead">
          <div className="mark">
            <svg width="30" height="30" viewBox="0 0 30 30" aria-hidden="true">
              <rect width="30" height="30" rx="3" fill="#161A1B" />
              <path
                d="M7 21V11.5c0-.4.5-.6.8-.3l3 3c.3.3.8.3 1.1 0L15 11l3.1 3.2c.3.3.8.3 1.1 0l3-3c.3-.3.8-.1.8.3V21"
                stroke="#C9CFCB"
                strokeWidth="1.8"
                fill="none"
                strokeLinecap="round"
              />
              <path d="M6 21h18" stroke="#0B6E5A" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
            <div>
              <h1>Maxey Construction</h1>
              <p>Financial command — owner view</p>
            </div>
          </div>
          <div className="stamp">
            Live cost and billing data as of <b>{asOf}</b>
          </div>
        </div>

        {/* ============ HEALTH BAR ============ */}
        <div className="health">
          <div className="hcell">
            <div className="hlabel">Cash on hand{cash ? ` · checked ${fmtDateTime(cash.recordedAt)}` : ""}</div>
            <div className="hval">{cash ? php(cash.amount) : "—"}</div>
            <div>
              <div className="hsub">
                {runway.weeksOfRunway != null ? (
                  <>
                    Covers <b>{runway.weeksOfRunway.toFixed(0)} weeks</b> at the trailing 3-month burn rate
                  </>
                ) : cash ? (
                  "Not enough billing history yet to estimate runway"
                ) : (
                  "No cash balance recorded yet"
                )}
              </div>
              <UpdateCashForm current={cash?.amount ?? null} />
            </div>
          </div>
          <div className="hcell">
            <div className="hlabel">Backlog</div>
            <div className="hval">{phpCompact(backlog.backlogRemaining)}</div>
            <div className="hsub">
              {backlog.monthsRemaining != null ? (
                <>
                  <b>{backlog.monthsRemaining.toFixed(1)} months</b> of work at collections pace
                </>
              ) : (
                "No collections history yet to pace against"
              )}
              <br />
              {phpCompact(backlog.totalContract)} total contract value active
            </div>
          </div>
          <div className="hcell">
            <div className="hlabel">Net margin, all logged work</div>
            <div className={`hval ${netMarginPct >= 0 ? "" : "neg"}`}>{netMarginPct.toFixed(1)}%</div>
            <div className="hsub">
              {php(waterfall.netProfit)} on {php(waterfall.earnedRevenue)} earned
            </div>
          </div>
          <div className="hcell">
            <div className="hlabel">Receivables outstanding</div>
            <div className="hval">{phpCompact(totalReceivable)}</div>
            <div className="hsub">
              {over90 && over90.total > 0 ? (
                <span className="warn">{php(over90.total)} billed over 90 days ago</span>
              ) : (
                "None flagged over 90 days"
              )}
              <br />
              {php(totalRetention)} retention held by clients
            </div>
          </div>
        </div>

        {/* ============ WIP HERO ============ */}
        <div className="grid">
          <div className="panel c12">
            <div className="panel-head">
              <div className="panel-title">Work in progress — earned against billed</div>
              <div className="panel-note">
                Bars right of the line: the client has paid ahead of the work, funding you. Bars left: you are
                funding the client out of your own cash.
              </div>
            </div>
            <div className="panel-body" style={{ paddingTop: 14 }}>
              {wip.rows.length === 0 ? (
                <p className="emptynote">No projects yet.</p>
              ) : (
                <>
                  <table className="wip">
                    <thead>
                      <tr>
                        <th>Project</th>
                        <th>Contract</th>
                        <th>Cost to date</th>
                        <th>Complete</th>
                        <th>Earned</th>
                        <th>Billed</th>
                        <th>Margin at completion</th>
                        <th className="mid">Billing position</th>
                      </tr>
                    </thead>
                    <tbody>
                      {wip.rows.map((r) => {
                        const delta = r.targetMarginPct != null ? r.marginAtCompletionPct - r.targetMarginPct : null;
                        return (
                          <tr key={r.id}>
                            <td>
                              <div className="pname">{r.name}</div>
                              <div className="pmeta">
                                {r.clientName}
                                {r.isCompleted && " · Completed"}
                              </div>
                            </td>
                            <td>{php(r.contractValue)}</td>
                            <td>{php(r.costToDate)}</td>
                            <td>
                              <div className="prog">
                                <div className="progbar">
                                  <i style={{ width: `${Math.min(Math.max(r.pctComplete, 0), 100)}%` }} />
                                </div>
                                {r.pctComplete.toFixed(0)}%
                              </div>
                            </td>
                            <td>{php(r.earned)}</td>
                            <td>{php(r.billed)}</td>
                            <td>
                              <span className={`fade ${delta != null && delta < 0 ? "neg" : delta != null && delta > 0 ? "pos" : ""}`}>
                                {r.marginAtCompletionPct.toFixed(1)}%
                              </span>
                              <div className="pmeta">
                                {r.targetMarginPct != null ? (
                                  <>
                                    bid {r.targetMarginPct.toFixed(1)}% ·{" "}
                                    {delta != null && (delta >= 0 ? "+" : "")}
                                    {delta?.toFixed(1)}pt
                                  </>
                                ) : (
                                  "no bid % set"
                                )}
                                <SetTargetMarginForm projectId={r.id} current={r.targetMarginPct} />
                              </div>
                            </td>
                            <td className="gapcell">{gapBar(r.billingGap)}</td>
                          </tr>
                        );
                      })}
                      {wip.totals && (
                        <tr className="totrow">
                          <td>{wip.totals.name}</td>
                          <td>{php(wip.totals.contractValue)}</td>
                          <td>{php(wip.totals.costToDate)}</td>
                          <td>{wip.totals.pctComplete.toFixed(0)}%</td>
                          <td>{php(wip.totals.earned)}</td>
                          <td>{php(wip.totals.billed)}</td>
                          <td>{wip.totals.marginAtCompletionPct.toFixed(1)}%</td>
                          <td className="gapcell">{gapBar(wip.totals.billingGap)}</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                  <div className="axislabels">
                    <span>under-billed</span>
                    <span>billed = earned</span>
                    <span>over-billed</span>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* ============ CASH FORECAST + COLLECTIONS ============ */}
        <div className="grid">
          <div className="panel c7">
            <div className="panel-head">
              <div className="panel-title">Thirteen-week cash projection</div>
              <div className="panel-note">
                Straight-line projection from the trailing 3-month net burn rate — not a scheduled forecast, since
                individual future collection dates aren&apos;t tracked yet.
              </div>
            </div>
            <div className="panel-body">
              {runway.cashOnHand == null ? (
                <p className="emptynote">Record a cash balance above to see a projection.</p>
              ) : (
                <>
                  {(() => {
                    const weeks = 13;
                    const points: [number, number][] = [];
                    for (let w = 0; w <= weeks; w++) {
                      points.push([w, Math.max(runway.cashOnHand! - runway.weeklyBurn * w, 0)]);
                    }
                    const maxY = Math.max(runway.cashOnHand!, runway.safeFloor, 1);
                    const x = (w: number) => 46 + (w / weeks) * 602;
                    const y = (v: number) => 190 - (v / maxY) * 174;
                    const poly = points.map(([w, v]) => `${x(w)},${y(v)}`).join(" ");
                    const floorY = y(runway.safeFloor);
                    const lowPoint = points[points.length - 1];
                    return (
                      <svg viewBox="0 0 660 212" style={{ width: "100%", height: "auto", display: "block" }} role="img" aria-label="Cash balance projection over thirteen weeks">
                        <g stroke="#E4E8E4" strokeWidth="1">
                          <line x1="46" y1="20" x2="648" y2="20" />
                          <line x1="46" y1="70" x2="648" y2="70" />
                          <line x1="46" y1="120" x2="648" y2="120" />
                          <line x1="46" y1="170" x2="648" y2="170" />
                        </g>
                        <g fill="#8B9491" fontSize="10" textAnchor="end">
                          <text x="40" y="24">{phpCompact(maxY)}</text>
                          <text x="40" y="174">₱0</text>
                        </g>
                        <line x1="46" y1={floorY} x2="648" y2={floorY} stroke="#A03426" strokeWidth="1.2" strokeDasharray="5 4" />
                        <text x="648" y={floorY - 5} fill="#A03426" fontSize="10" textAnchor="end" fontWeight="600">
                          Trailing average monthly outflow {phpCompact(runway.safeFloor)}
                        </text>
                        <polyline points={poly} fill="none" stroke="#0B6E5A" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
                        <circle cx={x(lowPoint[0])} cy={y(lowPoint[1])} r="4" fill="#FAFBFA" stroke={lowPoint[1] < runway.safeFloor ? "#A03426" : "#0B6E5A"} strokeWidth="2" />
                        <line x1="46" y1="190" x2="648" y2="190" stroke="#D2D7D3" strokeWidth="1" />
                        <g fill="#8B9491" fontSize="10" textAnchor="middle">
                          <text x="46" y="205">W1</text>
                          <text x={x(6.5)} y="205">W7</text>
                          <text x="648" y="205">W13</text>
                        </g>
                      </svg>
                    );
                  })()}
                  <div className="legend">
                    <span>
                      <i style={{ background: "#0B6E5A" }} />
                      Projected balance ({runway.weeklyBurn >= 0 ? "burning" : "building"} {phpCompact(Math.abs(runway.weeklyBurn))}/week)
                    </span>
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="panel c5">
            <div className="panel-head">
              <div className="panel-title">Collections</div>
              <div className="panel-note">{php(aging.total)} in open billing terms</div>
            </div>
            <div className="panel-body">
              {aging.total === 0 ? (
                <p className="emptynote">No open payment terms logged yet.</p>
              ) : (
                <ul className="aging">
                  {aging.buckets.map((b) => (
                    <li key={b.label}>
                      <span className="aglabel">{b.label}</span>
                      <div className="agtrack">
                        <i style={{ width: `${(b.total / maxAging) * 100}%`, background: AGING_COLORS[b.label] }} />
                      </div>
                      <span className={`agval ${b.label === "Over 90 days" && b.total > 0 ? "neg" : ""}`}>{php(b.total)}</span>
                    </li>
                  ))}
                </ul>
              )}
              <div className="subhead">Retention held by clients — {php(totalRetention)}</div>
              {finances.filter((f) => f.retentionHeld > 0).length === 0 ? (
                <p className="emptynote">No retention currently held.</p>
              ) : (
                <ul className="ret">
                  {finances
                    .filter((f) => f.retentionHeld > 0)
                    .map((f) => (
                      <li key={f.id}>
                        <span>{f.name}</span>
                        <b>{php(f.retentionHeld)}</b>
                      </li>
                    ))}
                </ul>
              )}
            </div>
          </div>
        </div>

        {/* ============ MARGIN FADE + WATERFALL ============ */}
        <div className="grid">
          <div className="panel c5">
            <div className="panel-head">
              <div className="panel-title">Margin fade</div>
              <div className="panel-note">Forecast at completion against the margin you bid</div>
            </div>
            <div className="panel-body">
              {wip.rows.length === 0 ? (
                <p className="emptynote">No projects yet.</p>
              ) : (
                <ul className="fadelist">
                  {wip.rows.map((r) => {
                    if (r.targetMarginPct == null) {
                      return (
                        <li key={r.id}>
                          <div className="fadetop">
                            <span className="fadename">
                              {r.name}
                              {r.isCompleted && " · Completed"}
                            </span>
                            <span className="fadedelta">
                              no bid % set
                              <SetTargetMarginForm projectId={r.id} current={null} />
                            </span>
                          </div>
                        </li>
                      );
                    }
                    const delta = r.marginAtCompletionPct - r.targetMarginPct;
                    const span = Math.max(r.targetMarginPct, r.marginAtCompletionPct, 1);
                    const actWidth = Math.max(Math.min((r.marginAtCompletionPct / span) * 100, 100), 0);
                    const bidLeft = Math.max(Math.min((r.targetMarginPct / span) * 100, 100), 0);
                    return (
                      <li key={r.id}>
                        <div className="fadetop">
                          <span className="fadename">
                            {r.name}
                            {r.isCompleted && " · Completed"}
                          </span>
                          <span className={`fadedelta ${delta < 0 ? "neg" : delta > 0 ? "pos" : ""}`}>
                            {delta >= 0 ? "+" : ""}
                            {delta.toFixed(1)}pt
                          </span>
                        </div>
                        <div className="fadetrack">
                          <div
                            className="act"
                            style={{ width: `${actWidth}%`, background: delta < 0 ? "#A03426" : delta < 2 ? "#B07514" : "#0B6E5A" }}
                          />
                          <div className="bid" style={{ left: `${bidLeft}%` }} />
                        </div>
                        <div className="fadefoot">
                          <span>now {r.marginAtCompletionPct.toFixed(1)}%</span>
                          <span>bid {r.targetMarginPct.toFixed(1)}%</span>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>

          <div className="panel c7">
            <div className="panel-head">
              <div className="panel-title">Where the money goes</div>
              <div className="panel-note">Earned revenue to net profit, across all logged work.</div>
            </div>
            <div className="panel-body">
              {waterfall.earnedRevenue === 0 ? (
                <p className="emptynote">No earned revenue logged yet.</p>
              ) : (
                (() => {
                  const gap = 84;
                  const barW = 62;
                  const chartH = 150;
                  const baseY = 168;
                  const scale = chartH / wf.maxVal;
                  const yOf = (v: number) => baseY - v * scale;
                  return (
                    <svg viewBox="0 0 660 210" style={{ width: "100%", height: "auto", display: "block" }} role="img" aria-label="Waterfall from earned revenue to net profit">
                      <line x1="42" y1={baseY} x2="650" y2={baseY} stroke="#D2D7D3" />
                      {wf.bars.map((b, i) => {
                        const x = 54 + i * gap;
                        const top = Math.max(b.top, b.bottom);
                        const bottom = Math.min(b.top, b.bottom);
                        const isNeg = i === 1 || i === 2 || i === 4;
                        const isSub = i === 3;
                        const color = isNeg ? "#A03426" : isSub ? "#0B6E5A" : i === 0 ? "#3D5A73" : "#0B6E5A";
                        const opacity = isNeg ? 0.82 : isSub ? 0.45 : 1;
                        return (
                          <g key={b.label}>
                            <rect x={x} y={yOf(top)} width={barW} height={Math.max(yOf(bottom) - yOf(top), 1)} fill={color} opacity={opacity} />
                            <text x={x + barW / 2} y={yOf(top) - 6} fill={isNeg ? "#A03426" : "#161A1B"} fontSize="11" fontWeight="700" textAnchor="middle">
                              {isNeg ? "−" : ""}
                              {phpCompact(Math.abs(b.top - b.bottom))}
                            </text>
                            <text x={x + barW / 2} y="185" fill="#5A6462" fontSize="10" textAnchor="middle">
                              {b.label}
                            </text>
                          </g>
                        );
                      })}
                    </svg>
                  );
                })()
              )}
            </div>
          </div>
        </div>

        {/* ============ BACKLOG + PIPELINE + RISK ============ */}
        <div className="grid">
          <div className="panel c5">
            <div className="panel-head">
              <div className="panel-title">Backlog burn-down</div>
              <div className="panel-note">Straight-line projection off the trailing 3-month collections pace</div>
            </div>
            <div className="panel-body">
              {backlog.monthsRemaining == null || backlog.backlogRemaining === 0 ? (
                <p className="emptynote">
                  {backlog.backlogRemaining === 0 ? "No backlog remaining right now." : "Not enough collections history yet to project."}
                </p>
              ) : (
                (() => {
                  const months = Math.min(Math.ceil(backlog.monthsRemaining!), 12);
                  const x = (m: number) => 36 + (m / months) * 434;
                  const y = (v: number) => 130 - (v / backlog.backlogRemaining) * 106;
                  const points = Array.from({ length: months + 1 }, (_, m) => [
                    x(m),
                    y(Math.max(backlog.backlogRemaining * (1 - m / backlog.monthsRemaining!), 0)),
                  ]);
                  const poly = points.map(([px, py]) => `${px},${py}`).join(" ");
                  return (
                    <svg viewBox="0 0 480 168" style={{ width: "100%", height: "auto", display: "block" }} role="img" aria-label="Backlog burn-down projection">
                      <g stroke="#E4E8E4" strokeWidth="1">
                        <line x1="36" y1="24" x2="470" y2="24" />
                        <line x1="36" y1="77" x2="470" y2="77" />
                      </g>
                      <g fill="#8B9491" fontSize="10" textAnchor="end">
                        <text x="31" y="28">{phpCompact(backlog.backlogRemaining)}</text>
                        <text x="31" y="134">₱0</text>
                      </g>
                      <line x1="36" y1="130" x2="470" y2="130" stroke="#D2D7D3" />
                      <polyline points={poly} fill="none" stroke="#3D5A73" strokeWidth="2.2" strokeLinejoin="round" />
                      <text x="253" y="163" fill="#5A6462" fontSize="10.5" textAnchor="middle">
                        Backlog clears in ~{backlog.monthsRemaining!.toFixed(1)} months if nothing new is signed.
                      </text>
                    </svg>
                  );
                })()
              )}
            </div>
          </div>

          <div className="panel c4">
            <div className="panel-head">
              <div className="panel-title">Bid pipeline</div>
            </div>
            <div className="panel-body">
              {pipeline.stages.every((s) => s.count === 0) ? (
                <p className="emptynote">No open leads right now.</p>
              ) : (
                <ul className="funnel">
                  {pipeline.stages.map((s) => (
                    <li key={s.status}>
                      <div className="ftop">
                        <span>
                          {s.label} · {s.count}
                        </span>
                        <b>{php(s.value)}</b>
                      </div>
                      <div className="ftrack">
                        <i style={{ width: `${(s.value / maxPipelineValue) * 100}%` }} />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              <div className="hitrate">
                <div>
                  <div className="bignum">{pipeline.winRate != null ? `${pipeline.winRate.toFixed(0)}%` : "—"}</div>
                  <div className="hsub">Win rate, all time</div>
                </div>
                <div>
                  <div className="bignum">{phpCompact(pipeline.weightedPipeline)}</div>
                  <div className="hsub">Weighted pipeline</div>
                </div>
              </div>
            </div>
          </div>

          <div className="panel c3">
            <div className="panel-head">
              <div className="panel-title">Needs a decision</div>
            </div>
            <div className="panel-body">
              {flags.length === 0 ? (
                <p className="emptynote">Nothing flagged right now.</p>
              ) : (
                <ul className="flags">
                  {flags.map((f, i) => (
                    <li key={i}>
                      <span className="dot" style={{ background: f.tone === "critical" ? "#A03426" : "#B07514" }} />
                      <div className="flagtxt">
                        <b>{f.title}</b>
                        <span>{f.detail}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>

        <div className="foot">
          <span>Cash on hand is a manual check — no bank integration exists. Everything else is computed live from real records.</span>
          <span>Percent complete uses the weighted work-item rollup. Earned = percent complete × contract value.</span>
        </div>
      </div>
    </div>
  );
}
