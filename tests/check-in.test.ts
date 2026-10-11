/// <reference types="bun" />
import { beforeEach, describe, expect, mock, test } from 'bun:test';

let authenticated = true;
let authorized = true;
let validQR = true;
let registration = {
  id: 'registration', eventId: 'event', userId: 'participant', qrCode: 'qr',
  status: 'approved', checkpointCheckIns: [] as { checkpoint: string }[]
};
const updateRegistration = mock(async (_qr: string, checkpoint: string) => ({
  ...registration,
  status: 'checked-in',
  checkpointCheckIns: [...registration.checkpointCheckIns, { checkpoint }]
}));
const execute = mock(async () => ({ rows: [registration] }));

mock.module('@/lib/auth', () => ({ auth: async () => authenticated ? { user: { id: 'scanner' } } : null }));
mock.module('@/lib/db/user', () => ({
  hasVolunteerPrivileges: async () => authorized,
  getUserById: async () => ({ id: 'participant', name: 'Participant', email: 'participant@example.com' })
}));
mock.module('@/lib/qr', () => ({ verifyQRCode: async () => validQR ? { eventId: 'event' } : null }));
mock.module('@/lib/db/client', () => ({ turso: { execute } }));
mock.module('@/lib/db/event', () => ({ getEventById: async () => ({
  id: 'event', name: 'Event', checkpoints: ['Checkin', 'Lunch', 'Dinner']
}) }));
mock.module('@/lib/db/registration', () => ({
  rowToRegistration: () => registration,
  checkInParticipantAtCheckpoint: updateRegistration
}));

const { POST } = await import('../src/app/api/events/check-in/route');
const scan = (checkpoint: string, approval?: unknown) => POST(new Request('http://localhost/api/events/check-in', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ qrToken: 'qr', checkpoint, approveSkippedCheckpoints: approval })
}));

beforeEach(() => {
  authenticated = authorized = validQR = true;
  registration = { ...registration, status: 'approved', checkpointCheckIns: [] };
  updateRegistration.mockClear();
  execute.mockClear();
});

describe('checkpoint approval', () => {
  test('lists all skipped checkpoints without updating the registration', async () => {
    const response = await scan('Dinner');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      success: false, requiresApproval: true, checkpoint: 'Dinner', skippedCheckpoints: ['Checkin', 'Lunch']
    });
    expect(updateRegistration).not.toHaveBeenCalled();
  });

  test('only missing earlier checkpoints are included', async () => {
    registration.checkpointCheckIns = [{ checkpoint: 'Lunch' }];
    expect(await (await scan('Dinner')).json()).toMatchObject({ skippedCheckpoints: ['Checkin'] });
  });

  test('explicit approval checks in only at the requested checkpoint and logs the override', async () => {
    const response = await scan('Dinner', true);
    expect(await response.json()).toMatchObject({
      success: true, registration: { checkpointCheckIns: [{ checkpoint: 'Dinner' }] }
    });
    expect(updateRegistration).toHaveBeenCalledWith('qr', 'Dinner', 'scanner');
    expect(JSON.stringify(execute.mock.calls)).toContain('Skipped checkpoints approved: Checkin, Lunch');
  });

  test('truthy non-boolean approval does not bypass confirmation', async () => {
    expect(await (await scan('Dinner', 'true')).json()).toMatchObject({ requiresApproval: true });
    expect(updateRegistration).not.toHaveBeenCalled();
  });

  test('first checkpoint and normal sequential check-ins need no confirmation', async () => {
    expect(await (await scan('Checkin')).json()).toMatchObject({ success: true });
    registration.checkpointCheckIns = [{ checkpoint: 'Checkin' }, { checkpoint: 'Lunch' }];
    expect(await (await scan('Dinner')).json()).toMatchObject({ success: true });
  });

  test('approval does not bypass duplicate or invalid checkpoint validation', async () => {
    registration.checkpointCheckIns = [{ checkpoint: 'Dinner' }];
    expect((await scan('Dinner', true)).status).toBe(409);
    expect((await scan('Unknown', true)).status).toBe(400);
    expect(updateRegistration).not.toHaveBeenCalled();
  });

  test('approval does not bypass registration approval', async () => {
    registration.status = 'pending';
    expect((await scan('Dinner', true)).status).toBe(403);
    expect(updateRegistration).not.toHaveBeenCalled();
  });

  test('approval still requires authentication, scanner privileges, and a valid QR', async () => {
    authenticated = false;
    expect((await scan('Dinner', true)).status).toBe(401);
    authenticated = true;
    authorized = false;
    expect((await scan('Dinner', true)).status).toBe(403);
    authorized = true;
    validQR = false;
    expect((await scan('Dinner', true)).status).toBe(400);
    expect(updateRegistration).not.toHaveBeenCalled();
  });
});
