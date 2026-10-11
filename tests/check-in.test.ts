/// <reference types="bun" />
import { beforeEach, describe, expect, mock, spyOn, test } from 'bun:test';
import { NextRequest } from 'next/server';

let authenticated = true;
let authorized = true;
let validQR = true;
let role = 'admin';
let scannerUserId = 'scanner';
let userRole = 'participant';
let userExists = true;
let organizerId: string | undefined;
let eventExists = true;
let registrationOpen = false;
let unlockedCheckpoints = ['Checkin', 'Lunch', 'Dinner'];
let registration = {
  id: 'registration', eventId: 'event', userId: 'participant', qrCode: 'qr',
  status: 'approved', checkpointCheckIns: [] as { checkpoint: string }[]
};
const updateRegistration = mock(async (_qr: string, checkpoint: string) => ({
  ...registration,
  status: 'checked-in',
  checkpointCheckIns: [...registration.checkpointCheckIns, { checkpoint }]
}));
const execute = mock(async (input?: { sql: string }) => ({ rows: input?.sql.includes('FROM events')
  ? eventExists ? [{ id: 'event', organizer_id: 'owner', is_registration_open: 1 }] : []
  : [registration] }));
const createRegistration = mock(async (input: Record<string, unknown>) => ({
  ...input, id: 'new-registration', status: 'pending', createdAt: new Date()
}));
const generateRegistrationQR = mock(async () => 'qr');
const currentUser = () => ({ id: 'participant', name: 'Participant', email: 'participant@example.com', role: userRole, organizerId });
const promoteVolunteer = mock(async (_userId: string, newRole: string, newOrganizerId?: string) => {
  userRole = newRole;
  if (newOrganizerId !== undefined) organizerId = newOrganizerId;
  return currentUser();
});
const assignOrganizer = mock(async (_userId: string, newOrganizerId: string) => {
  organizerId = newOrganizerId;
  return currentUser();
});
const organizerVolunteers = mock(async (_organizerId: string) => userRole === 'volunteer' ? [currentUser()] : []);
const startCheckpoint = mock(async (_eventId: string, checkpoint: string) => ({ unlockedCheckpoints: ['Checkin', checkpoint] }));
const stopCheckpoint = mock(async (_eventId: string, checkpoint: string) => ({ unlockedCheckpoints: unlockedCheckpoints.filter(value => value !== checkpoint) }));

mock.module('@/lib/auth', () => ({ auth: async () => authenticated ? { user: { id: scannerUserId, role } } : null }));
mock.module('@/lib/db/user', () => ({
  hasVolunteerPrivileges: async () => authorized,
  hasOrganizerPrivileges: async () => authorized && ['admin', 'organizer'].includes(role),
  getUserById: async () => userExists ? currentUser() : null,
  updateUserRole: promoteVolunteer,
  assignVolunteerToOrganizer: assignOrganizer,
  getOrganizerVolunteers: organizerVolunteers,
  getAllUsers: async () => [currentUser()]
}));
mock.module('@/lib/qr', () => ({
  verifyQRCode: async () => validQR ? { eventId: 'event' } : null,
  generateQRCodeForStorage: generateRegistrationQR
}));
mock.module('@/lib/db/client', () => ({ turso: { execute } }));
mock.module('@/lib/db/event', () => ({
  getEventById: async () => eventExists ? {
    id: 'event', name: 'Event', organizerId: 'owner', checkpoints: ['Checkin', 'Lunch', 'Dinner'],
    unlockedCheckpoints, startDate: new Date('2020-01-01'), endDate: new Date('2020-01-02'),
    isRegistrationOpen: registrationOpen, formSchema: { fields: [] }
  } : null,
  unlockCheckpoint: startCheckpoint,
  lockCheckpoint: stopCheckpoint
}));
mock.module('@/lib/db/registration', () => ({
  rowToRegistration: () => registration,
  checkInParticipantAtCheckpoint: updateRegistration,
  createRegistration
}));

const { POST } = await import('../src/app/api/events/check-in/route');
const { POST: manageCheckpoint } = await import('../src/app/api/events/[id]/unlock-checkpoint/route');
const { GET: listVolunteers } = await import('../src/app/api/volunteers/route');
const { POST: assignVolunteer } = await import('../src/app/api/volunteer/create/route');
const { POST: registerForEvent } = await import('../src/app/api/events/register/route');
const { POST: toggleRegistration } = await import('../src/app/api/events/[id]/toggle-registration/route');
const { proxy } = await import('../src/proxy');
const list = () => listVolunteers(new Request('http://localhost/api/volunteers?eventId=event'));
const routeParams = { params: Promise.resolve({ id: 'event' }) };
const control = (checkpoint: unknown, action: unknown) => manageCheckpoint(new NextRequest('http://localhost/api/events/event/unlock-checkpoint', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ checkpoint, action })
}), routeParams);
const assign = (body: unknown = { userId: 'participant' }) => assignVolunteer(new Request('http://localhost/api/volunteer/create', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ eventId: 'event', ...body as Record<string, unknown> })
}));
const scan = (checkpoint: string, approval?: unknown, eventId: unknown = 'event') => POST(new Request('http://localhost/api/events/check-in', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ qrToken: 'qr', checkpoint, approveSkippedCheckpoints: approval, eventId })
}));
const register = () => registerForEvent(new Request('http://localhost/api/events/register', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ eventId: 'event', responses: {} })
}));
const toggle = () => toggleRegistration(new NextRequest('http://localhost/api/events/event/toggle-registration', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isOpen: true })
}), routeParams);

beforeEach(() => {
  authenticated = authorized = validQR = true;
  userExists = eventExists = true;
  role = 'admin';
  scannerUserId = 'scanner';
  registrationOpen = false;
  userRole = 'participant';
  organizerId = undefined;
  unlockedCheckpoints = ['Checkin', 'Lunch', 'Dinner'];
  registration = { ...registration, status: 'approved', checkpointCheckIns: [] };
  updateRegistration.mockClear();
  execute.mockClear();
  promoteVolunteer.mockClear();
  assignOrganizer.mockClear();
  organizerVolunteers.mockClear();
  startCheckpoint.mockClear();
  stopCheckpoint.mockClear();
  createRegistration.mockClear();
  generateRegistrationQR.mockClear();
});

describe('rough-edge regressions', () => {
  test('admin and organizer can reach event creation; other roles cannot', async () => {
    for (const allowedRole of ['admin', 'organizer']) {
      role = allowedRole;
      const response = await proxy(new NextRequest('http://localhost/dashboard/events/create'));
      expect(response.headers.get('location')).toBeNull();
    }
    for (const otherRole of ['applicant', 'participant', 'volunteer', 'mentor']) {
      role = otherRole;
      expect((await proxy(new NextRequest('http://localhost/dashboard/events/create'))).headers.get('location')).toBe('http://localhost/dashboard');
    }
  });

  test('registration toggles require event ownership unless admin', async () => {
    role = 'organizer';
    expect((await toggle()).status).toBe(403);
    expect(execute.mock.calls.some(([input]) => input?.sql.includes('UPDATE events'))).toBe(false);
    scannerUserId = 'owner';
    expect((await toggle()).status).toBe(200);
    role = 'admin';
    scannerUserId = 'scanner';
    expect((await toggle()).status).toBe(200);
  });

  test('registration API enforces the same applicant restriction as the UI', async () => {
    registrationOpen = true;
    for (const otherRole of ['participant', 'volunteer', 'mentor', 'organizer', 'admin']) {
      role = otherRole;
      expect((await register()).status).toBe(403);
    }
    expect(createRegistration).not.toHaveBeenCalled();
    expect(generateRegistrationQR).not.toHaveBeenCalled();
    role = 'applicant';
    expect((await register()).status).toBe(200);
    expect(createRegistration).toHaveBeenCalledTimes(1);
  });

  test('scans for another selected event cannot check in, even with approval', async () => {
    expect((await scan('Checkin', false, 'other-event')).status).toBe(400);
    expect((await scan('Dinner', true, 'other-event')).status).toBe(400);
    expect(updateRegistration).not.toHaveBeenCalled();
    expect((await scan('Checkin', false, 'event')).status).toBe(200);
  });

  test('invalid event selections are rejected; legacy callers without a selector still work', async () => {
    for (const eventId of ['', ' ', 123, null]) {
      expect((await scan('Checkin', false, eventId)).status).toBe(400);
    }
    expect(updateRegistration).not.toHaveBeenCalled();
    const response = await POST(new Request('http://localhost/api/events/check-in', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ qrToken: 'qr', checkpoint: 'Checkin' })
    }));
    expect(response.status).toBe(200);
  });

  test('applicant registration still respects manual closure and authentication', async () => {
    role = 'applicant';
    expect((await register()).status).toBe(400);
    authenticated = false;
    expect((await register()).status).toBe(401);
    expect(createRegistration).not.toHaveBeenCalled();
  });

  test('registration toggle rejects missing events and unprivileged roles', async () => {
    eventExists = false;
    expect((await toggle()).status).toBe(404);
    eventExists = true;
    role = 'participant';
    expect((await toggle()).status).toBe(403);
    authenticated = false;
    expect((await toggle()).status).toBe(401);
    expect(execute.mock.calls.some(([input]) => input?.sql.includes('UPDATE events'))).toBe(false);
  });
});

describe('manual checkpoint controls', () => {
  test('admins can start and stop checkpoints outside event dates', async () => {
    expect((await control('Dinner', 'unlock')).status).toBe(200);
    expect(startCheckpoint).toHaveBeenCalledWith('event', 'Dinner');
    expect((await control('Dinner', 'lock')).status).toBe(200);
    expect(stopCheckpoint).toHaveBeenCalledWith('event', 'Dinner');
  });

  test('non-owner organizers and volunteers cannot change checkpoint state', async () => {
    role = 'organizer';
    expect((await control('Dinner', 'unlock')).status).toBe(403);
    role = 'volunteer';
    expect((await control('Dinner', 'lock')).status).toBe(403);
    expect(startCheckpoint).not.toHaveBeenCalled();
    expect(stopCheckpoint).not.toHaveBeenCalled();
  });

  test('invalid checkpoints and actions never mutate state', async () => {
    expect((await control('Unknown', 'lock')).status).toBe(400);
    expect((await control(123, 'unlock')).status).toBe(400);
    expect((await control('Dinner', 'invalid')).status).toBe(400);
    expect(startCheckpoint).not.toHaveBeenCalled();
    expect(stopCheckpoint).not.toHaveBeenCalled();
  });

  test('stopped checkpoints reject scans and skipped-checkpoint overrides for all roles', async () => {
    unlockedCheckpoints = [];
    for (const scannerRole of ['admin', 'organizer', 'volunteer']) {
      role = scannerRole;
      expect((await scan('Dinner', true)).status).toBe(403);
    }
    expect(updateRegistration).not.toHaveBeenCalled();
    unlockedCheckpoints = ['Dinner'];
    expect(await (await scan('Dinner', true)).json()).toMatchObject({ success: true });
  });
});

describe('event volunteers', () => {
  test('admins add volunteers through existing roles after event start and registration closure', async () => {
    const response = await assign();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, user: { role: 'volunteer', organizerId: 'owner' } });
    expect(promoteVolunteer).toHaveBeenCalledWith('participant', 'volunteer', 'owner');
    expect(assignOrganizer).not.toHaveBeenCalled();
  });

  test('event volunteer list uses the existing organizer association', async () => {
    userRole = 'volunteer';
    organizerId = 'owner';
    const response = await list();
    expect(await response.json()).toMatchObject({ volunteers: [currentUser()] });
    expect(organizerVolunteers).toHaveBeenCalledWith('owner');
  });

  test('unauthorized users and non-owner organizers cannot manage event volunteers', async () => {
    for (const otherRole of ['organizer', 'volunteer', 'participant', 'applicant']) {
      role = otherRole;
      expect((await assign()).status).toBe(403);
      expect((await list()).status).toBe(403);
    }
    authenticated = false;
    expect((await assign()).status).toBe(401);
    expect(promoteVolunteer).not.toHaveBeenCalled();
  });

  test('invalid users and events cannot be assigned', async () => {
    expect((await assign({ userId: '' })).status).toBe(400);
    expect((await assign({ userId: 123 })).status).toBe(400);
    userExists = false;
    expect((await assign()).status).toBe(404);
    userExists = true;
    eventExists = false;
    expect((await assign()).status).toBe(404);
    expect(promoteVolunteer).not.toHaveBeenCalled();
  });

  test('volunteer creation cannot overwrite staff roles', async () => {
    for (const otherRole of ['admin', 'organizer', 'mentor']) {
      userRole = otherRole;
      expect((await assign()).status).toBe(400);
    }
    expect(promoteVolunteer).not.toHaveBeenCalled();
  });

  test('volunteer creation does not replace existing scanner authorization', async () => {
    expect((await assign()).status).toBe(200);
    authorized = false;
    expect((await scan('Dinner', true)).status).toBe(403);
    expect(updateRegistration).not.toHaveBeenCalled();
  });

  test('applicants and existing volunteers use the same role and organizer helpers', async () => {
    for (const eligibleRole of ['applicant', 'volunteer']) {
      userRole = eligibleRole;
      expect((await assign()).status).toBe(200);
      expect(userRole).toBe('volunteer');
      expect(organizerId).toBe('owner');
    }
  });

  test('legacy volunteer creation still works without an event and keeps organizer links', async () => {
    organizerId = 'existing-owner';
    const response = await assignVolunteer(new Request('http://localhost/api/volunteer/create', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: 'participant' })
    }));
    expect(await response.json()).toMatchObject({ success: true, user: { role: 'volunteer', organizerId: 'existing-owner' } });
    expect(assignOrganizer).not.toHaveBeenCalled();
  });

  test('failed atomic promotion returns an error without a separate assignment write', async () => {
    organizerId = 'existing-owner';
    promoteVolunteer.mockImplementationOnce(async () => { throw new Error('Organizer assignment rejected'); });
    const errorLog = spyOn(console, 'error').mockImplementation(() => {});
    try {
      const response = await assign();
      expect(response.status).toBe(500);
      expect(await response.json()).toMatchObject({ error: 'Failed to create volunteer' });
      expect(userRole).toBe('participant');
      expect(organizerId).toBe('existing-owner');
      expect(promoteVolunteer).toHaveBeenCalledTimes(1);
      expect(assignOrganizer).not.toHaveBeenCalled();
    } finally {
      errorLog.mockRestore();
    }
  });
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
