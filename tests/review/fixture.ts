import type { Note, Review, ReviewNode } from '../../src/review/schema.js';

export const api: ReviewNode = {
  id: 'api',
  label: 'invites route',
  path: 'src/routes/invites.ts',
  rev: 'rev-api',
  lines: [
    { kind: 'hunk', text: '@@ -10,3 +10,4 @@ router' },
    { kind: 'ctx', n: 10, text: 'router.post("/invites", async (req) => {' },
    { kind: 'del', n: 11, text: '  const email = req.body.email' },
    { kind: 'add', n: 11, text: '  const { email, teamId } = req.body' },
    { kind: 'add', n: 12, text: '  await invite(email, teamId)' },
  ],
};

export const mailer: ReviewNode = { id: 'mailer', label: 'mailer', path: 'src/mail/invite.ts', rev: 'rev-mailer', note: 'generated file, not shown' };

export const queue: ReviewNode = { id: 'queue', label: 'queue' };

export function review(notes: Note[] = [], nodes: ReviewNode[] = [api, mailer, queue]): Review {
  return {
    version: 1,
    change: { slug: 'invites', title: 'Invites by email', kind: 'map', branch: 'feat/invites', html: '/out/20261028-090503-invites.html', renderedAt: new Date(2026, 9, 28, 9, 5, 3).toISOString() },
    nodes,
    notes,
  };
}

export function note(id: string, over: Partial<Note> = {}): Note {
  return { id, node: 'api', rev: 'rev-api', kind: 'comment', body: 'check this', state: 'pending', at: '2026-10-28T08:05:03.000Z', ...over };
}
