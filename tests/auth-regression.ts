// Run separately to keep the real auth callbacks isolated from API module mocks.
import assert from 'node:assert/strict';
import { mock } from 'bun:test';
import type { UserProfile } from '../src/types';

const fixture: UserProfile = {
  id: 'db-user', name: 'User', email: 'user@example.com', role: 'volunteer',
  organizerId: 'organizer', createdAt: new Date(1), updatedAt: new Date(1)
};
let existingUser: UserProfile | null = fixture;
let failure: 'lookup' | 'create' | undefined;
mock.module('@/lib/db/user', () => ({
  getUserByEmail: async () => {
    if (failure === 'lookup') throw new Error('Database unavailable');
    return existingUser;
  },
  createUser: async (user: Omit<UserProfile, 'createdAt' | 'updatedAt'>) => {
    if (failure === 'create') throw new Error('Database unavailable');
    return { ...user, createdAt: new Date(1), updatedAt: new Date(1) };
  }
}));
mock.module('@/lib/env', () => ({ getMissingEnvVars: () => [] }));
const { authConfig } = await import('../src/lib/auth');
const jwt = authConfig.callbacks!.jwt!;
const token = { id: '', role: 'applicant' as const, isApproved: false };
const user = { id: 'oauth-user', name: 'User', email: fixture.email };
const signIn = async () => jwt({ token, user, account: null });

const resolved = await signIn();
assert.equal(resolved.id, fixture.id);
assert.equal(resolved.role, 'volunteer');
assert.equal(resolved.organizerId, 'organizer');
failure = 'lookup';
await assert.rejects(signIn(), /Unable to authenticate user/);
existingUser = null;
failure = 'create';
await assert.rejects(signIn(), /Unable to authenticate user/);
failure = undefined;
const created = await signIn();
assert.equal(created.role, process.env.ADMIN_EMAIL?.toLowerCase() === user.email ? 'admin' : 'applicant');
assert.ok(created.id);
console.log('Auth checks passed: database-backed roles, fail-closed lookup and creation, new-user role.');
