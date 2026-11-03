import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/rules/git-files.js', async (orig) => ({
  ...(await orig<typeof import('../../src/rules/git-files.js')>()),
  gitChangedFiles: () => Array.from({ length: 300_000 }, (_, i) => `f${i}`),
}));

const { gitFiles } = await import('../../src/rules/selection.js');

describe('S-36 gitFiles', () => {
  it('handles a huge changed-file list without overflowing the stack', () => {
    expect(gitFiles('/repo', { git: true })).toHaveLength(300_000);
  });
});
