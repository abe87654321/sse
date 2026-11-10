import { startAnomalyScheduler } from '../services/anomaly-scheduler';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('anomaly scheduler', () => {
  it('scans on a fixed interval and logs counts to stderr', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    let scans = 0;

    const timer = startAnomalyScheduler(async () => {
      scans += 1;
      return { summary: { total: 3 } };
    }, 5);

    expect(timer).not.toBeNull();
    await sleep(25);
    clearInterval(timer!);

    expect(scans).toBeGreaterThan(1);
    expect(errorSpy).toHaveBeenCalledWith('[ontology] anomalies: 3');
    errorSpy.mockRestore();
  });

  it('logs scan failures to stderr', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const timer = startAnomalyScheduler(async () => {
      throw new Error('graph offline');
    }, 5);

    await sleep(15);
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
