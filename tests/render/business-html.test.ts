import { createHash } from 'node:crypto';
import { Window } from 'happy-dom';
import { describe, expect, it } from 'vitest';
import { businessPage } from '../../src/render/business/html.js';
import { validateBusinessSpec, type BusinessSpec } from '../../src/spec/business.js';
import { business, businessExplain } from '../fixtures/business.js';

const meta = { generatedAt: new Date('2026-11-08T12:00:00Z'), repo: 'demo', change: { slug: 'new-refund-rules.business', branch: 'feat/refunds', at: '2026-11-08T12:00:00.000Z' } };

function spec(edit?: (raw: ReturnType<typeof business>) => void): BusinessSpec {
  const raw = business();
  edit?.(raw);
  const r = validateBusinessSpec(raw);
  if (!r.ok) throw new Error(r.errors.join('\n'));
  return r.spec;
}

const doc = (html: string) => new new Window().DOMParser().parseFromString(html, 'text/html');
const page = (s = spec()) => businessPage(s, meta);
const visible = (html: string): string => {
  const d = doc(html);
  d.querySelectorAll('script, style').forEach((e) => e.remove());
  return d.body.textContent!;
};
const card = (html: string, id: string) => doc(html).querySelector(`[data-item="${id}"]`)!;

describe('business page', () => {
  it('has the five parts in order: header, journeys, rules, saved data, questions', () => {
    const html = page();
    const d = doc(html);
    expect(d.querySelector('h1')!.textContent).toBe('New refund rules');
    expect(d.querySelector('.summary')!.textContent).toContain('14 days');
    expect([...d.querySelectorAll('section h2')].map((h) => h.textContent)).toEqual(['What people will experience', 'Rules, before and after', 'What the business now keeps', 'Questions for you']);
    expect(d.querySelectorAll('.journey')).toHaveLength(2);
    expect(d.querySelectorAll('.rule')).toHaveLength(2);
    expect(d.querySelectorAll('.datum')).toHaveLength(1);
    expect(d.querySelectorAll('.qa')).toHaveLength(1);
    expect(d.querySelector('.legend')!.textContent).toContain("Agent's reading — please confirm");
    expect(d.querySelector('time')!.textContent).toMatch(/^8 Nov 2026/);
    expect(d.querySelector('.bar')!.textContent).toContain('answers and notes so far');
    expect(d.querySelector('#send')!.textContent).toBe('Send back to developer');
  });

  it('leaves out a part that has no items', () => {
    const s = spec((raw) => {
      raw.data = [];
      raw.questions = [];
    });
    expect([...doc(page(s)).querySelectorAll('section h2')].map((h) => h.textContent)).toEqual(['What people will experience', 'Rules, before and after']);
  });

  it('marks new steps, changed steps and removed steps; plain steps carry no mark', () => {
    const j = card(page(), 'J1');
    const now = [...j.querySelectorAll('.now .step')];
    const after = [...j.querySelectorAll('.after .step')];
    expect(now.map((s) => s.className)).toEqual(['step same', 'step rem']);
    expect(after.map((s) => s.className)).toEqual(['step same', 'step add', 'step add']);
    expect(now[1]!.querySelector('.mk')!.textContent).toBe('Removed');
    expect(after[1]!.querySelector('.mk')!.textContent).toBe('New');
    expect(now[0]!.querySelector('.mk')).toBeNull();
    const changed = spec((raw) => (raw.journeys[0].after[0].change = 'changed'));
    expect(card(page(changed), 'J1').querySelector('.after .step.chg .mk')!.textContent).toBe('Changed');
  });

  it('shows a rule before and after with its exceptions, and a new rule as new', () => {
    const r1 = card(page(), 'R1');
    expect(r1.querySelector('.ba')!.textContent).toContain('Before');
    expect(r1.querySelector('.ba dd.was')!.textContent).toContain('30 days');
    expect(r1.querySelector('.exc')!.textContent).toContain('Annual plans keep 30 days.');
    const r2 = card(page(), 'R2');
    expect(r2.querySelector('.mk')!.textContent).toBe('New rule');
    expect(r2.querySelector('.ba')!.textContent).not.toContain('Before');
    expect(r2.querySelector('.exc')).toBeNull();
  });

  it('tags checked items solid and readings dashed; Yes / No only on readings', () => {
    const d = doc(page());
    for (const id of ['J1', 'R1', 'D1']) {
      const c = d.querySelector(`[data-item="${id}"]`)!;
      expect(c.querySelector('.ev.ok')!.textContent).toBe('Checked in code');
      expect(c.classList.contains('guess')).toBe(false);
      expect(c.querySelector('[data-verdict]')).toBeNull();
    }
    for (const id of ['J2', 'R2']) {
      const c = d.querySelector(`[data-item="${id}"]`)!;
      expect(c.querySelector('.ev.guess')!.textContent).toBe("Agent's reading — please confirm");
      expect(c.classList.contains('guess')).toBe(true);
      expect([...c.querySelectorAll('[data-verdict]')].map((b) => [b.getAttribute('data-verdict'), b.getAttribute('aria-pressed')])).toEqual([['yes', 'false'], ['no', 'false']]);
    }
    expect(d.querySelector('[data-item="Q1"] [data-verdict]')).toBeNull();
  });

  it('gives every journey, rule and data card a note box, and every question an answer box that names its item', () => {
    const d = doc(page());
    for (const id of ['J1', 'J2', 'R1', 'R2', 'D1']) {
      expect(d.querySelector(`[data-item="${id}"] [data-cbtn="${id}"]`)!.textContent).toBe('Add a note');
      expect(d.querySelector(`[data-item="${id}"] textarea[data-note="${id}"]`)).not.toBeNull();
    }
    const q = d.querySelector('[data-item="Q1"]')!;
    expect(q.querySelector('textarea[data-answer="Q1"]')).not.toBeNull();
    const about = q.querySelector('.about a')!;
    expect(about.textContent).toBe('Manager approval');
    expect(about.getAttribute('href')).toBe('#i-R2');
    expect(d.getElementById('i-R2')).not.toBeNull();
  });

  it('shows no id, file name, path or tech map link anywhere a person reads', () => {
    const text = visible(page());
    for (const hidden of ['J1', 'J2', 'R1', 'R2', 'D1', 'Q1', 'refund-policy', 'subscription-model', 'refund-requests', 'approvals', 'instant-refunds-flag']) {
      expect(text).not.toMatch(new RegExp(`(^|[^A-Za-z-])${hidden}([^A-Za-z-]|$)`));
    }
    expect(text).not.toMatch(/\.(ts|js|json|py)\b|\/Users|node_modules/);
    expect(visible(page()).toLowerCase()).not.toContain('glossary');
    expect(doc(page()).querySelectorAll('a[href]:not([href^="#"])')).toHaveLength(0);
  });

  it('escapes hostile words everywhere they land', () => {
    const evil = '<img src=x onerror=alert(1)>"&\'';
    const s = spec((raw) => {
      raw.title = 'Refunds';
      raw.summary = 'Fine summary.';
    });
    const hostile = {
      ...s,
      title: evil,
      summary: evil,
      journeys: [{ ...s.journeys[0]!, name: evil, who: evil, now: [{ text: evil }], after: [{ text: evil, change: 'new' as const }] }],
      rules: [{ ...s.rules[0]!, name: evil, before: evil, after: evil, exceptions: [evil] }],
      data: [{ ...s.data[0]!, name: evil, what: evil, why: evil }],
      questions: [{ ...s.questions[0]!, about: 'R1', text: evil }],
    };
    const html = businessPage(hostile, meta);
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;&quot;&amp;&#39;');
    const d = doc(html);
    expect(d.querySelectorAll('img')).toHaveLength(0);
    expect(d.querySelector('[data-item="R1"]')!.getAttribute('data-name')).toBe(evil);
  });

  it('allows no inline script but the one the policy hashes', () => {
    const html = page();
    const csp = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]*)">/)![1]!;
    expect(csp).not.toMatch(/script-src[^;]*unsafe/);
    const scripts = [...doc(html).querySelectorAll('script')].filter((s) => s.getAttribute('type') !== 'application/json');
    expect(scripts).toHaveLength(1);
    expect(csp).toContain(`script-src 'sha256-${createHash('sha256').update(scripts[0]!.textContent).digest('base64')}'`);
    expect(csp).toContain("default-src 'none'");
    expect(html).not.toMatch(/<(script|link)[^>]+src=|https?:\/\/(?!www\.w3\.org)/);
  });

  it('carries the change so the page and the review file pair up', () => {
    const d = doc(page());
    expect(JSON.parse(d.getElementById('spec-data')!.textContent!)).toEqual({ page: 'business', repoKey: 'demo', change: meta.change });
    expect(doc(page()).documentElement.getAttribute('data-theme')).toBe('auto');
    expect(doc(businessPage(spec(), { ...meta, theme: 'dark' })).documentElement.getAttribute('data-theme')).toBe('dark');
  });
});

describe('business explain page', () => {
  const explain = (edit?: (raw: ReturnType<typeof businessExplain>) => void): string => {
    const raw = businessExplain();
    edit?.(raw);
    const r = validateBusinessSpec(raw);
    if (!r.ok) throw new Error(r.errors.join('\n'));
    return businessPage(r.spec, meta);
  };

  it('has the explain sections and no word of a change', () => {
    const html = explain();
    const d = doc(html);
    expect([...d.querySelectorAll('section h2')].map((h) => h.textContent)).toEqual(['How it works', 'Rules today', 'Odd cases', 'What we keep and why', 'Open questions']);
    const text = visible(html);
    for (const word of ['Now', 'After this change', 'New rule', 'Changed rule', 'Kept', 'Removed', 'Before', "developer's change"]) expect(text).not.toContain(word);
    expect(d.querySelector('.legend')!.textContent).not.toContain('Steps');
    expect(d.querySelectorAll('.mk')).toHaveLength(0);
    expect(d.querySelector('footer')!.textContent).toContain('Made by codechart from the code as it is today.');
  });

  it('shows a fork as "If <condition> → <step>" in one column of steps', () => {
    const d = doc(explain());
    const steps = [...d.querySelectorAll('[data-item="J1"] .step')].map((x) => x.textContent);
    expect(steps).toEqual(['An invoice is created', 'If the total is zero → The charge is skipped', 'The card is charged']);
    expect(d.querySelectorAll('[data-item="J1"] .j-col')).toHaveLength(1);
  });

  it('is read-only: no notes, Yes or No, answers or send bar, and questions are plain text with a link', () => {
    const html = explain((raw) => (raw.cases[0].evidence = 'reading'));
    const d = doc(html);
    expect(d.querySelectorAll('textarea, button, [data-cbtn], [data-verdict], [data-note], [data-answer], [data-rev], #send, #send-modal, .bar')).toHaveLength(0);
    expect(visible(html)).not.toMatch(/Send back|Add a note|Yes, that|answers and notes|please confirm/);
    const c = d.querySelector('[data-item="C1"]')!;
    expect(c.getAttribute('data-kind')).toBe('case');
    expect(c.querySelector('h3')!.textContent).toBe('The card is declined');
    expect(c.querySelector('.ev.guess')!.textContent).toBe("Agent's reading — not checked in code");
    expect(d.querySelector('.legend .ev.guess')!.textContent).toBe("Agent's reading — not checked in code");
    expect(d.querySelector('[data-item="Q1"] .about a')!.getAttribute('href')).toBe('#i-C1');
  });

  it('shows no id, tech link or flow step anywhere a person reads', () => {
    const text = visible(explain());
    for (const hidden of ['J1', 'R1', 'C1', 'D1', 'Q1', 'flow:create', 'stripe', 'api']) expect(text).not.toMatch(new RegExp(`(^|[^A-Za-z-])${hidden}([^A-Za-z-]|$)`));
  });

  it('leaves out sections without items', () => {
    const d = doc(explain((raw) => {
      raw.cases = [];
      raw.questions[0].about = 'R1';
    }));
    expect([...d.querySelectorAll('section h2')].map((h) => h.textContent)).toEqual(['How it works', 'Rules today', 'What we keep and why', 'Open questions']);
  });
});
