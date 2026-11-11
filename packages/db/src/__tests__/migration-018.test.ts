import { readFileSync } from 'fs';
import { join } from 'path';

const migrations = join(__dirname, '..', 'migrations');
const sql = readFileSync(
  join(migrations, '018_disable_external_password_sentinels.sql'),
  'utf-8'
);

describe('018_disable_external_password_sentinels', () => {
  it('replaces the external provisioning sentinels with an unusable value', () => {
    expect(sql).toMatch(/UPDATE users SET password_hash = '!'/i);
    expect(sql).toMatch(/'scim_managed_no_pwd'/);
    expect(sql).toMatch(/'mdm_managed_no_pwd'/);
    expect(sql).toMatch(/''/);
  });

  it('only targets exact sentinel values, never bcrypt hashes', () => {
    expect(sql).toMatch(/WHERE password_hash IN \(/i);
    expect(sql).not.toMatch(/password_hash\s*=\s*'\$2/);
    expect(sql).not.toMatch(/LIKE/i);
  });
});
