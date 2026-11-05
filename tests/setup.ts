// No test may reach npm or write the real update cache; tests of the check pass their own env and fetch.
process.env.CODECHART_NO_UPDATE_CHECK = '1';
globalThis.fetch = (() => Promise.reject(new Error('network is off in tests'))) as typeof fetch;
