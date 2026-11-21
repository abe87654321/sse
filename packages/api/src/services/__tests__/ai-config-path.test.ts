import { existsSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { resolveAiConfigPath } from '../ai-engines';

describe('resolveAiConfigPath', () => {
  const original = process.env.AI_CONFIG_PATH;

  afterEach(() => {
    if (original === undefined) delete process.env.AI_CONFIG_PATH;
    else process.env.AI_CONFIG_PATH = original;
  });

  it('honours an explicit AI_CONFIG_PATH', () => {
    const explicit = resolve(__dirname, 'custom-ai-config.json');
    process.env.AI_CONFIG_PATH = explicit;
    expect(resolveAiConfigPath()).toBe(explicit);
  });

  it('defaults to the repo root instead of the process cwd', () => {
    delete process.env.AI_CONFIG_PATH;
    const path = resolveAiConfigPath();
    expect(path.endsWith('ai-config.json')).toBe(true);
    // The repo root contains pnpm-workspace.yaml; packages/api does not.
    expect(existsSync(join(dirname(path), 'pnpm-workspace.yaml'))).toBe(true);
  });
});
