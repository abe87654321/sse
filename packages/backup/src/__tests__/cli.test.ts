import { runCli } from '../cli';

test('help exits successfully and does not log an error', async () => {
  const logs: string[] = [];
  const write = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
  try {
    const code = await runCli(['--help'], { logger: (line) => logs.push(line) });
    expect(code).toBe(0);
    expect(logs).toEqual([]);
  } finally {
    write.mockRestore();
  }
});
