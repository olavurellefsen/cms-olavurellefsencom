"use client";

import { ArrowUpRight, LoaderCircle, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

type Overview = {
  avgDuration: number;
  bounceRate: number;
  pageviews: number;
  visitors: number;
};

type TimeBucket = { date: string; pageviews: number; visitors: number };
type PageStat = { pageviews: number; path: string; visitors: number };
type SourceStat = { pageviews: number; source: string; visitors: number };
type AnalyticsState = {
  currentVisitors: number;
  overview: Overview;
  pages: PageStat[];
  sources: SourceStat[];
  timeseries: TimeBucket[];
};

const dashboardUrl =
  "https://web-analytics.usable.dev/org/c05bfc29-8063-570a-8703-329dab2732d7/sites/c8c6bafd-5ab6-407e-98cc-6de8a9a2e3c4";

export function CmsAnalytics({ sessionToken }: { sessionToken?: string | null }) {
  const [days, setDays] = useState(7);
  const [state, setState] = useState<AnalyticsState>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const range = useMemo(() => analyticsRange(days), [days]);

  const load = useCallback(async () => {
    if (!sessionToken) {
      setError("Sign in to Usable CMS again to load analytics.");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");
    try {
      const query = `from=${range.from}&to=${range.to}`;
      const [overview, timeseries, pages, sources, current] = await Promise.all([
        readAnalytics<Overview>(`metric=overview&${query}`, sessionToken),
        readAnalytics<TimeBucket[]>(`metric=timeseries&interval=day&${query}`, sessionToken),
        readAnalytics<PageStat[]>(`metric=pages&${query}`, sessionToken),
        readAnalytics<SourceStat[]>(`metric=sources&${query}`, sessionToken),
        readAnalytics<{ visitors: number }>("metric=current-visitors", sessionToken),
      ]);
      setState({
        currentVisitors: current.visitors,
        overview,
        pages,
        sources,
        timeseries,
      });
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Analytics could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [range, sessionToken]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="cms-analytics" aria-busy={loading}>
      <div className="cms-analytics__controls">
        <label>
          <span>Range</span>
          <select value={days} onChange={(event) => setDays(Number(event.target.value))}>
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
          </select>
        </label>
        <button type="button" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={loading ? "cms-spin" : undefined} size={15} /> Refresh
        </button>
      </div>

      {loading && !state ? (
        <div className="cms-analytics__loading">
          <LoaderCircle className="cms-spin" size={19} /> Loading private analytics
        </div>
      ) : null}

      {error ? (
        <div className="cms-analytics__empty" role="alert">
          <strong>Analytics unavailable</strong>
          <p>{error}</p>
          <a href={dashboardUrl} target="_blank" rel="noreferrer">
            Open Usable Web Analytics <ArrowUpRight size={14} />
          </a>
        </div>
      ) : null}

      {state ? (
        <>
          <div className="cms-analytics__stats">
            <AnalyticsStat label="Visitors" value={formatNumber(state.overview.visitors)} />
            <AnalyticsStat label="Pageviews" value={formatNumber(state.overview.pageviews)} />
            <AnalyticsStat label="Bounce rate" value={formatPercent(state.overview.bounceRate)} />
            <AnalyticsStat label="Active now" value={formatNumber(state.currentVisitors)} live />
          </div>

          <section className="cms-analytics__panel" aria-labelledby="analytics-traffic-title">
            <header>
              <div>
                <span className="cms-kicker">Traffic</span>
                <h3 id="analytics-traffic-title">Visitors by day</h3>
              </div>
              <small>
                {shortDate(range.from)}–{shortDate(range.to)}
              </small>
            </header>
            <TrafficChart buckets={state.timeseries} />
          </section>

          <div className="cms-analytics__breakdowns">
            <AnalyticsList
              title="Top pages"
              empty="No pageviews in this period."
              items={state.pages.map((page) => ({
                label: page.path || "/",
                value: `${formatNumber(page.visitors)} visitors`,
              }))}
            />
            <AnalyticsList
              title="Top sources"
              empty="No referrers in this period."
              items={state.sources.map((source) => ({
                label: source.source || "Direct / none",
                value: `${formatNumber(source.visitors)} visitors`,
              }))}
            />
          </div>

          <a className="cms-analytics__open" href={dashboardUrl} target="_blank" rel="noreferrer">
            Open full analytics dashboard <ArrowUpRight size={15} />
          </a>
          <p className="cms-analytics__privacy">
            Cookie-free analytics. Visitor IP addresses are never stored.
          </p>
        </>
      ) : null}
    </div>
  );
}

function AnalyticsStat({ label, live, value }: { label: string; live?: boolean; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
      {live ? <i aria-hidden="true" title="Live" /> : null}
    </div>
  );
}

function TrafficChart({ buckets }: { buckets: TimeBucket[] }) {
  const max = Math.max(1, ...buckets.map((bucket) => bucket.visitors));
  if (!buckets.length) return <p className="cms-analytics__no-data">No traffic yet.</p>;
  return (
    <div className="cms-analytics__chart" role="img" aria-label="Daily visitors chart">
      {buckets.map((bucket) => (
        <span
          key={bucket.date}
          style={{ height: `${Math.max(4, (bucket.visitors / max) * 100)}%` }}
          title={`${shortDate(bucket.date)}: ${bucket.visitors} visitors`}
          aria-hidden="true"
        />
      ))}
    </div>
  );
}

function AnalyticsList({
  empty,
  items,
  title,
}: {
  empty: string;
  items: Array<{ label: string; value: string }>;
  title: string;
}) {
  return (
    <section className="cms-analytics__panel">
      <header>
        <h3>{title}</h3>
      </header>
      {items.length ? (
        <ol className="cms-analytics__list">
          {items.slice(0, 5).map((item) => (
            <li key={item.label}>
              <span>{item.label}</span>
              <small>{item.value}</small>
            </li>
          ))}
        </ol>
      ) : (
        <p className="cms-analytics__no-data">{empty}</p>
      )}
    </section>
  );
}

async function readAnalytics<T>(query: string, sessionToken: string): Promise<T> {
  const response = await fetch(`/api/cms/analytics?${query}`, {
    headers: { "x-usable-cms-session": sessionToken },
    cache: "no-store",
  });
  const body = (await response.json().catch(() => null)) as ({ error?: string } & T) | null;
  if (!response.ok) throw new Error(body?.error || "Analytics could not be loaded.");
  return body as T;
}

function analyticsRange(days: number) {
  const to = new Date();
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - (days - 1));
  return { from: isoDay(from), to: isoDay(to) };
}

function isoDay(date: Date) {
  return date.toISOString().slice(0, 10);
}

function shortDate(value: string) {
  return new Intl.DateTimeFormat("en", { day: "numeric", month: "short", timeZone: "UTC" }).format(
    new Date(`${value.slice(0, 10)}T12:00:00Z`),
  );
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en", { notation: value >= 10_000 ? "compact" : "standard" }).format(
    value || 0,
  );
}

function formatPercent(value: number) {
  const percentage = value > 1 ? value : value * 100;
  return `${Math.round(percentage || 0)}%`;
}
