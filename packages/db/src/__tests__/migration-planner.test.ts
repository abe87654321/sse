import {
  migrationVersion,
  planPendingMigrations,
  planRollback,
} from '../migration-planner';

describe('migrationVersion', () => {
  it('strips the .sql extension', () => {
    expect(migrationVersion('001_initial.sql')).toBe('001_initial');
  });
});

describe('planPendingMigrations', () => {
  it('applies migrations in numeric order', () => {
    expect(
      planPendingMigrations(['010_invoice.sql', '002_notifications.sql', '001_initial.sql'], [])
    ).toEqual(['001_initial.sql', '002_notifications.sql', '010_invoice.sql']);
  });

  it('sorts numerically rather than lexicographically', () => {
    expect(
      planPendingMigrations(['100_c.sql', '020_b.sql', '009_a.sql'], [])
    ).toEqual(['009_a.sql', '020_b.sql', '100_c.sql']);
  });

  it('skips already applied migrations', () => {
    expect(
      planPendingMigrations(['001_initial.sql', '002_notifications.sql'], ['001_initial'])
    ).toEqual(['002_notifications.sql']);
  });

  it('ignores down migrations and non-sql files', () => {
    expect(
      planPendingMigrations(['001_initial.sql', '001_initial.down.sql', 'README.md'], [])
    ).toEqual(['001_initial.sql']);
  });

  it('ignores files without a numeric prefix', () => {
    expect(planPendingMigrations(['seed.sql', '001_initial.sql'], [])).toEqual([
      '001_initial.sql',
    ]);
  });

  it('returns an empty plan when everything is applied', () => {
    expect(
      planPendingMigrations(['001_initial.sql', '002_notifications.sql'], [
        '001_initial',
        '002_notifications',
      ])
    ).toEqual([]);
  });
});

describe('planRollback', () => {
  it('rolls back the highest applied migration when a down file exists', () => {
    expect(
      planRollback(
        ['001_initial', '002_notifications'],
        ['001_initial.sql', '002_notifications.sql', '002_notifications.down.sql']
      )
    ).toEqual({ version: '002_notifications', downFile: '002_notifications.down.sql' });
  });

  it('returns a null down file when the migration has no down script', () => {
    expect(planRollback(['001_initial'], ['001_initial.sql'])).toEqual({
      version: '001_initial',
      downFile: null,
    });
  });

  it('returns null when nothing has been applied', () => {
    expect(planRollback([], ['001_initial.sql'])).toBeNull();
  });
});
