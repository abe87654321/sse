import {
  ONTOLOGY_OUTBOX_LAG_LIMIT_SECONDS,
  decideHealth,
} from '../services/health';

describe('decideHealth', () => {
  it('keeps the legacy behaviour when v2 is off or in shadow', () => {
    expect(decideHealth({ mode: '0', oldestPendingAgeSeconds: 9999 })).toEqual({
      v2: false,
      healthy: true,
      statusCode: 200,
    });
    expect(decideHealth({ mode: 'shadow', oldestPendingAgeSeconds: 9999 })).toEqual({
      v2: false,
      healthy: true,
      statusCode: 200,
    });
  });

  it('is healthy when the outbox is within the lag limit', () => {
    expect(decideHealth({
      mode: 'on',
      oldestPendingAgeSeconds: ONTOLOGY_OUTBOX_LAG_LIMIT_SECONDS,
    })).toEqual({ v2: true, healthy: true, statusCode: 200 });
  });

  it('returns 503 when the outbox exceeds the lag limit', () => {
    expect(decideHealth({
      mode: 'on',
      oldestPendingAgeSeconds: ONTOLOGY_OUTBOX_LAG_LIMIT_SECONDS + 1,
    })).toEqual({
      v2: true,
      healthy: false,
      statusCode: 503,
      reason: 'outbox_lag',
    });
  });

  it('returns 503 when the outbox cannot be read', () => {
    expect(decideHealth({ mode: 'on', error: 'db down' })).toEqual({
      v2: true,
      healthy: false,
      statusCode: 503,
      reason: 'unavailable',
    });
  });
});
