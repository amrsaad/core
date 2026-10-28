import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const walk = (d: string): string[] => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));

describe('Sync Code', () => {
  const files = walk('src').filter((f) => /\.(ts|tsx)$/.test(f));
  it('enthält kein Token', () => {
    for (const f of files) expect(readFileSync(f, 'utf8'), f).not.toMatch(/github_pat_[A-Za-z0-9_]{10,}|ghp_[A-Za-z0-9]{10,}|gho_[A-Za-z0-9]{10,}/);
  });
  it('spricht im Sync nur mit api.github.com', () => {
    for (const f of files.filter((x) => x.includes('/sync/'))) {
      const urls = readFileSync(f, 'utf8').match(/https?:\/\/[^\s'"`)]+/g) ?? [];
      for (const u of urls) expect(u, f).toMatch(/^https:\/\/api\.github\.com/);
    }
  });
});
