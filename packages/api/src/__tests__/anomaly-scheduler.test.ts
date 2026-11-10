import {
  DEFAULT_ANOMALY_INTERVAL_MS,
  anomalyIntervalMs,
  startAnomalyScheduler,
} from '../services/anomaly-scheduler';

describe('anomalyIntervalMs', () => {
  const original = process.env.ONTOLOGY_ANOMALY_INTERVAL_MS;

  afterEach(() => {
    if (original === undefined) delete process.env.ONTOLOGY_ANOMALY_INTERVAL_MS;
    else process.env.ONTOLOGY_ANOMALY_INTERVAL_MS = original;
  });

  it('defaults to 24h when unset or non-numeric', () => {
    delete process.env.ONTOLOGY_ANOMALY_INTERVAL_MS;
    expect(anomalyIntervalMs()).toBe(DEFAULT_ANOMALY_INTERVAL_MS);

    process.env.ONTOLOGY_ANOMALY_INTERVAL_MS = 'not-a-number';
    expect(anomalyIntervalMs()).toBe(DEFAULT_ANOMALY_INTERVAL_MS);
  });

  it('returns a positive configured interval verbatim', () => {
    process.env.ONTOLOGY_ANOMALY_INTERVAL_MS = '5000';
    expect(anomalyIntervalMs()).toBe(5000);
  });

  it('returns explicit zero/negative values so scheduling is disabled', () => {
    const scan = async () => ({ summary: { total: 0 } });

    process.env.ONTOLOGY_ANOMALY_INTERVAL_MS = '0';
    expect(anomalyIntervalMs()).toBe(0);
    expect(startAnomalyScheduler(scan, anomalyIntervalMs())).toBeNull();

    process.env.ONTOLOGY_ANOMALY_INTERVAL_MS = '-5000';
    expect(anomalyIntervalMs()).toBe(-5000);
    expect(startAnomalyScheduler(scan, anomalyIntervalMs())).toBeNull();
  });
});

describe('anomaly scheduler', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('scans on a fixed interval and logs counts to stderr', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    let scans = 0;

    jest.useFakeTimers();
    const timer = startAnomalyScheduler(async () => {
      scans += 1;
      return { summary: { total: 3 } };
    }, 5);

    expect(timer).not.toBeNull();
    await jest.advanceTimersByTimeAsync(25);
    clearInterval(timer!);

    expect(scans).toBeGreaterThan(1);
    expect(errorSpy).toHaveBeenCalledWith('[ontology] anomalies: 3');
    errorSpy.mockRestore();
  });

  it('logs scan failures to stderr', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    jest.useFakeTimers();
    const timer = startAnomalyScheduler(async () => {
      throw new Error('graph offline');
    }, 5);

    await jest.advanceTimersByTimeAsync(15);
    clearInterval(timer!);

    expect(errorSpy).toHaveBeenCalledWith('[ontology] anomaly scan failed: graph offline');
    errorSpy.mockRestore();
  });

  it('disables scanning for non-positive intervals', () => {
    const scan = async () => ({ summary: { total: 0 } });
    expect(startAnomalyScheduler(scan, 0)).toBeNull();
    expect(startAnomalyScheduler(scan, -1)).toBeNull();
    expect(startAnomalyScheduler(scan, Number.NaN)).toBeNull();
  });
});
