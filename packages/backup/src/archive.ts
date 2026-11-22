import { create, x } from 'tar';

export async function createArchive(sourceDir: string, archivePath: string): Promise<void> {
  await create({ gzip: true, cwd: sourceDir, file: archivePath, portable: true }, ['.']);
}

export async function extractArchive(archivePath: string, targetDir: string): Promise<void> {
  await x({ file: archivePath, cwd: targetDir, strict: true });
}
