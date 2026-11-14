import https from 'node:https';
// Dates in expectations are UTC; the machine's zone must not shift them.
process.env.TZ = 'UTC';
// No test may reach npm or write the real update cache; tests of the check pass their own env and fetch.
process.env.CODECHART_NO_UPDATE_CHECK = '1';
globalThis.fetch = (() => Promise.reject(new Error('network is off in tests'))) as typeof fetch;
const realGet = https.get;
https.get = ((url: unknown, ...rest: unknown[]) => {
  if (!['127.0.0.1', 'localhost'].includes(new URL(String(url)).hostname)) throw new Error('network is off in tests');
  return (realGet as (...a: unknown[]) => unknown)(url, ...rest);
}) as typeof https.get;
