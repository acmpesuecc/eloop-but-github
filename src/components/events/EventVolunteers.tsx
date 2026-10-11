'use client';

import { useCallback, useEffect, useState } from 'react';
import type { UserProfile } from '@/types';

export default function EventVolunteers({ eventId }: { eventId: string }) {
  const [volunteers, setVolunteers] = useState<UserProfile[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [userId, setUserId] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [rosterResponse, usersResponse] = await Promise.all([
        fetch(`/api/volunteers?eventId=${encodeURIComponent(eventId)}`), fetch('/api/admin/users')
      ]);
      const [rosterData, usersData] = await Promise.all([rosterResponse.json(), usersResponse.json()]);
      if (!rosterResponse.ok || !usersResponse.ok) {
        throw new Error(rosterData.error || usersData.error || 'Failed to load volunteers');
      }
      setVolunteers(rosterData.volunteers);
      setUsers(usersData.users);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load volunteers');
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => { void load(); }, [load]);

  const addVolunteer = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!userId || saving) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch('/api/volunteer/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, eventId })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to add volunteer');
      setVolunteers(previous => [...previous.filter(volunteer => volunteer.id !== data.user.id), data.user]);
      setUsers(previous => previous.map(user => user.id === data.user.id ? { ...user, ...data.user } : user));
      setUserId('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add volunteer');
    } finally {
      setSaving(false);
    }
  };

  const candidates = users.filter(user =>
    ['applicant', 'participant', 'volunteer'].includes(user.role) && !volunteers.some(volunteer => volunteer.id === user.id)
  );

  return (
    <section className="mx-6 bg-white border border-slate-200 rounded-2xl shadow-sm p-6 space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Event Volunteers</h2>
        <p className="text-sm text-slate-500 mt-1">Add volunteers anytime, including after the event starts or registration closes.</p>
        <p className="text-sm text-slate-500 mt-1">Adding a person sets their existing role to Volunteer and assigns them to this event’s organizer. This is the same volunteer system used across the dashboard, including other events from that organizer. Newly promoted users should sign out and sign back in.</p>
      </div>
      {error && <p role="alert" className="text-sm text-rose-600">{error} <button onClick={load} disabled={loading || saving} className="underline">Retry loading</button></p>}
      {loading ? <p className="text-sm text-slate-500">Loading volunteers...</p> : (
        <>
          <form onSubmit={addVolunteer} className="flex flex-col sm:flex-row gap-3">
            <label htmlFor="event-volunteer" className="sr-only">Select volunteer</label>
            <select id="event-volunteer" value={userId} onChange={e => setUserId(e.target.value)} disabled={saving} className="flex-1 min-w-0 border border-slate-300 rounded-lg px-3 py-2 text-slate-900">
              <option value="">Select a person</option>
              {candidates.map(user => <option key={user.id} value={user.id}>{user.name} ({user.email}) — {user.role}</option>)}
            </select>
            <button type="submit" disabled={!userId || saving} className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50">
              {saving ? 'Adding...' : 'Add Volunteer'}
            </button>
          </form>
          {volunteers.length === 0 ? <p className="text-sm text-slate-500">No volunteers added to this event yet.</p> : (
            <ul className="space-y-2" aria-live="polite">
              {volunteers.map(volunteer => (
                <li key={volunteer.id} className="border border-slate-200 rounded-lg p-3">
                  <p className="font-medium text-slate-900">{volunteer.name}</p>
                  <p className="text-sm text-slate-500">{volunteer.email}</p>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
