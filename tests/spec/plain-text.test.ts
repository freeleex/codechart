import { describe, expect, it } from 'vitest';
import { plainTextIssues, techIdIssue } from '../../src/spec/plain-text.js';

describe('plain words check: rejected', () => {
  it.each([
    ['a file path', 'Changed in src/refunds/policy.ts today', 'file name or path'],
    ['a relative path', 'See ./config/refund for details', 'file name or path'],
    ['a file name', 'Edit settings.yaml before', 'file name or path'],
    ['camelCase', 'Uses refundWindow to decide', 'refundWindow'],
    ['PascalCase', 'Calls RefundPolicyService first', 'RefundPolicyService'],
    ['snake_case', 'The refund_window setting', 'refund_window'],
    ['an empty call', 'It runs approve() once', 'approve()'],
    ['a call with arguments', 'It runs approve(order) once', 'looks like code'],
    ['a dotted identifier', 'Reads refund.window each time', 'refund.window'],
    ['a list', 'Steps [one, two]', 'looks like code'],
    ['an assignment', 'window = 14', 'looks like code'],
    ['an ellipsis', 'Waiting... for approval', 'looks like code'],
    ['a backtick', 'Use `refund` here', 'looks like code'],
    ['a hash', 'Fixed in a1b2c3d4', 'hash'],
    ['a web address', 'Details at https://example.com/refunds', 'web address'],
    ['a bare domain', 'Ask on shop.com today', 'web address'],
    ['an env var', 'Turn on INSTANT_REFUNDS now', 'setting name'],
  ])('%s', (_, text, expected) => {
    const issues = plainTextIssues(text);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.join('\n')).toContain(expected);
    expect(issues.join('\n')).toContain('plain words');
  });

  it('names the offending word in the message', () => {
    expect(plainTextIssues('Uses refundWindow to decide')).toEqual(['looks like code ("refundWindow"); write it in plain words']);
  });

  it('refuses control and invisible characters', () => {
    expect(plainTextIssues('Hidden‮text')).toEqual(['must not contain control or invisible characters']);
    expect(plainTextIssues('Zero​width')).toHaveLength(1);
  });
});

describe('plain words check: secrets', () => {
  it.each([
    ['an OpenAI-style key', 'Key is sk-abcdefghijklmnop1234', 'sk-a…'],
    ['a GitHub token', 'Use ghp_abcdefghijklmnop1234 here', 'ghp_…'],
    ['a fine-grained token', 'Use github_pat_abcdefgh12345678 here', 'gith…'],
    ['an AWS key', 'Key AKIAABCDEFGHIJKLMNOP is used', 'AKIA…'],
    ['a Slack token', 'Post with xoxb-1234567890-abcdef', 'xoxb…'],
    ['a password', 'password=hunter2hunter2', 'pass…'],
    ['a token with a colon and a digit', 'token: abc123def456', 'toke…'],
    ['a long blob', 'Value aGVsbG8gd29ybGQgdGhpcyBpcyBsb25nIGVub3VnaA is saved', 'aGVs…'],
    ['a PEM header', 'Starts with -----BEGIN PRIVATE KEY----- and more', '----…'],
  ])('%s, never echoed in full', (_, text, shown) => {
    const issues = plainTextIssues(text);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain('secret');
    expect(issues[0]).toContain(shown);
    const secret = /(sk-|ghp_|github_pat_|AKIA|xoxb-|password=|token: |aGVs)\S+/.exec(text)?.[0];
    if (secret) expect(issues[0]).not.toContain(secret);
  });
});

describe('plain words check: allowed', () => {
  it.each([
    'Refund now',
    'Say "Refund now" to the customer',
    "Customer gets a 'refund on its way' email",
    'e.g. annual plans keep their window',
    'That is, i.e. the same day.',
    'It takes 2.5 days',
    'Customers have 14 days to ask.',
    'Works on iPhone and iPhones',
    'Linked to GitHub, PayPal and YouTube',
    'Refunds above €100 wait for a manager.',
    'Yes/no, and/or on/off, open 24/7',
    'The agent asks the manager. Then the customer is told.',
    'Annual and monthly plans (30 or 14 days) differ: see the list.',
    'Price is >= €5 and <= €50',
    'Refund of 25%',
    'Password: 12-character minimum.',
    'Reset token: 24-hour lifetime.',
    'Opens on 01/12/2026 or 1/2.5 kg',
    'Customer(s) get a receipt.',
    'MasterCard, HubSpot, QuickBooks, FedEx, iTunes, PayPal, YouTube and LinkedIn',
  ])('%s', (text) => {
    expect(plainTextIssues(text)).toEqual([]);
  });
});

describe('plain words check: camel case', () => {
  it.each(['Calls RefundPolicyService first', 'Uses Step2Handler now', 'Uses refundWindow to decide', 'Uses getURL now'])('%s is refused', (text) => {
    expect(plainTextIssues(text).join('\n')).toContain('looks like code');
  });

  it('still refuses a long value after a colon', () => {
    expect(plainTextIssues('password: abc12345678')[0]).toContain('secret');
  });
});

describe('tech id in prose', () => {
  const ids = ['sign-in', 'opt-in', 'follow-up', 'refund-api', 'refund_policy', 'step-1', 'a-b-c'];

  it.each(['Sign-in now needs a code', 'Opt-in is optional', 'A follow-up call'])('%s passes', (text) => {
    expect(techIdIssue(text, ids)).toBeUndefined();
  });

  it.each([
    ['The refund-api decides', 'refund-api'],
    ['See refund_policy now', 'refund_policy'],
    ['See step-1 now', 'step-1'],
    ['See a-b-c now', 'a-b-c'],
  ])('%s is refused', (text, id) => {
    expect(techIdIssue(text, ids)).toBe(id);
  });
});
