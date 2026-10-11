import assert from 'node:assert/strict';
import { mock } from 'bun:test';

process.env.VERCEL = '1';
process.env.TURSO_DATABASE_URL = 'libsql://deployment.example.com';
process.env.TURSO_AUTH_TOKEN = 'test-token';

let options: unknown;
const webClient = { execute: async () => ({ rows: [] }) };
mock.module('@libsql/client/web', () => ({
  createClient: (config: unknown) => {
    options = config;
    return webClient;
  },
}));
mock.module('@libsql/client', () => ({
  createClient: () => { throw new Error('Vercel must not create a native database client'); },
}));

const { turso } = await import('../src/lib/db/client');
assert.equal(turso, webClient);
assert.deepEqual(options, {
  url: 'libsql://deployment.example.com',
  authToken: 'test-token',
});
console.log('Vercel database check passed: web client selected, URL and token preserved.');
