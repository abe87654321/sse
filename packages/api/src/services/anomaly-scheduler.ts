import { findAnomalies, getGraphStore } from '@sse/ontology';

export interface AnomalyScanResult {
  summary: { total: number };
}

export type AnomalyScan = () => Promise<AnomalyScanResult>;

export const DEFAULT_ANOMALY_INTERVAL_MS = 86_400_000;

/** Fixed interval (no cron parser). 0/negative disables the scan. */
export function anomalyIntervalMs(): number {
  const configured = Number(process.env.ONTOLOGY_ANOMALY_INTERVAL_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_ANOMALY_INTERVAL_MS;
}

/** Scan the live graph for the three v1 anomaly classes. */
export function defaultAnomalyScan(): Promise<AnomalyScanResult> {
  return findAnomalies(getGraphStore(), { limit: 500, scope: { kind: 'all' } });
}

export function startAnomalyScheduler(
  scan: AnomalyScan,
  intervalMs: number = anomalyIntervalMs(),
): NodeJS.Timeout | null {
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) return null;

  const timer = setInterval(() => {
    scan()
      .then((result) => console.error(`[ontology] anomalies: ${result.summary.total}`))
      .catch((err: any) => console.error(`[ontology] anomaly scan failed: ${err?.message ?? err}`));
  }, intervalMs);
  timer.unref?.();
  return timer;
}
