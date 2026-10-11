'use client';

import { useState, useEffect, use } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import EventVolunteers from '@/components/events/EventVolunteers';

interface EventDetails {
  id: string;
  name: string;
  description: string;
  date: string;
  location: string;
  organizerId: string;
  checkpoints?: string[];
  unlockedCheckpoints?: string[];
  isRegistrationOpen?: boolean;
  isTeamFormationOpen?: boolean;
  formSchema?: {
    fields: Array<{
      id: string;
      name: string;
      label: string;
      type: string;
      required: boolean;
    }>;
  };
}

interface PendingRegistration {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  responses: Record<string, unknown>;
  createdAt: string;
}

interface PageParams {
  params: Promise<{ id: string }>;
}

export default function EventPage({ params }: PageParams) {
  // Unwrap the params Promise using React.use()
  const resolvedParams = use(params);
  const eventId = resolvedParams.id;

  const router = useRouter();
  const { data: session } = useSession();
  const [event, setEvent] = useState<EventDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingRegistrations, setPendingRegistrations] = useState<PendingRegistration[]>([]);
  const [loadingPending, setLoadingPending] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  useEffect(() => {
    const fetchEvent = async () => {
      try {
        const response = await fetch(`/api/events/${eventId}`);

        if (!response.ok) {
          throw new Error(`Failed to fetch event: ${response.status}`);
        }

        const data = await response.json();
        setEvent(data.event);
      } catch (err) {
        console.error('Error fetching event:', err);
        setError(err instanceof Error ? err.message : 'Failed to fetch event');
      } finally {
        setLoading(false);
      }
    };

    fetchEvent();
  }, [eventId]);

  // Fetch pending registrations for organizers/admins
  useEffect(() => {
    const fetchPendingRegistrations = async () => {
      if (!session?.user?.role || !['admin', 'organizer'].includes(session.user.role)) {
        return;
      }

      try {
        setLoadingPending(true);
        const response = await fetch(`/api/events/${eventId}/pending-registrations`);

        if (response.ok) {
          const data = await response.json();
          setPendingRegistrations(data.registrations || []);
        }
      } catch (err) {
        console.error('Error fetching pending registrations:', err);
      } finally {
        setLoadingPending(false);
      }
    };

    if (session && event) {
      fetchPendingRegistrations();
    }
  }, [eventId, session, event]);

  const handleApprove = async (registrationId: string) => {
    try {
      setActionLoading(registrationId);
      const response = await fetch('/api/events/registrations/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ registrationId }),
      });

      if (response.ok) {
        // Remove from pending list
        setPendingRegistrations(prev => prev.filter(r => r.id !== registrationId));
      } else {
        const data = await response.json();
        alert(data.error || 'Failed to approve registration');
      }
    } catch (err) {
      console.error('Error approving registration:', err);
      alert('Failed to approve registration');
    } finally {
      setActionLoading(null);
    }
  };

  const handleReject = async (registrationId: string) => {
    try {
      setActionLoading(registrationId);
      const response = await fetch('/api/events/registrations/reject', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ registrationId }),
      });

      if (response.ok) {
        // Remove from pending list
        setPendingRegistrations(prev => prev.filter(r => r.id !== registrationId));
      } else {
        const data = await response.json();
        alert(data.error || 'Failed to reject registration');
      }
    } catch (err) {
      console.error('Error rejecting registration:', err);
      alert('Failed to reject registration');
    } finally {
      setActionLoading(null);
    }
  };

  const handleCheckpointToggle = async (checkpoint: string, currentlyUnlocked: boolean) => {
    if (!event) return;

    // Prevent concurrent actions
    try {
      setActionLoading(checkpoint);

      // If we're unlocking a checkpoint that is NOT the special "Checkin" checkpoint,
      // enforce the rule: only one non-checkin checkpoint may be unlocked at a time.
      // So lock any other unlocked non-checkin checkpoints first.
      // The server now applies this rule in one atomic update, without separate lock requests.

      // Now toggle the requested checkpoint (either lock or unlock)
      const action = currentlyUnlocked ? 'lock' : 'unlock';
      const response = await fetch(`/api/events/${eventId}/unlock-checkpoint`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ checkpoint, action }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to update checkpoint');
      }

      const data = await response.json();
      // Update local state with canonical server response
      setEvent(prev => prev ? ({ ...prev, unlockedCheckpoints: data.event.unlockedCheckpoints }) : null);
    } catch (err) {
      console.error('Error updating checkpoint:', err);
      alert(`Failed to update checkpoint access: ${(err as Error).message}`);
    } finally {
      setActionLoading(null);
    }
  };

  const handleRegistrationToggle = async (currentlyOpen: boolean) => {
    try {
      const response = await fetch(`/api/events/${eventId}/toggle-registration`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isOpen: !currentlyOpen }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to toggle registration');
      }

      const data = await response.json();

      // Update local state
      setEvent(prev => prev ? {
        ...prev,
        isRegistrationOpen: data.event.isRegistrationOpen
      } : null);
    } catch (err) {
      console.error('Error toggling registration:', err);
      alert(`Failed to toggle registration: ${(err as Error).message}`);
    }
  };

  const handleTeamFormationToggle = async (currentlyOpen: boolean) => {
    try {
      const response = await fetch(`/api/events/${eventId}/toggle-team-formation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isOpen: !currentlyOpen }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to toggle team formation');
      }

      const data = await response.json();

      // Update local state
      setEvent(prev => prev ? {
        ...prev,
        isTeamFormationOpen: data.event.isTeamFormationOpen
      } : null);
    } catch (err) {
      console.error('Error toggling team formation:', err);
      alert(`Failed to toggle team formation: ${(err as Error).message}`);
    }
  };

  if (loading) {
    return (
      <div className="mx-6 py-12">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-slate-200 rounded-lg w-1/2"></div>
          <div className="h-4 bg-slate-200 rounded-lg w-full"></div>
          <div className="h-4 bg-slate-200 rounded-lg w-3/4"></div>
        </div>
      </div>
    );
  }

  if (error || !event) {
    return (
      <div className="mx-6 py-12">
        <div className="bg-rose-50 border border-rose-200 text-rose-700 px-5 py-4 rounded-xl space-y-2">
          <p className="font-medium">Error: {error || 'Event not found'}</p>
          <p className="text-sm">The event you're looking for might have been removed or doesn't exist.</p>
        </div>
        <Link href="/dashboard/events" className="inline-flex items-center gap-2 text-indigo-600 hover:text-indigo-700 font-medium mt-6">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to Events
        </Link>
      </div>
    );
  }

  // Format the date for display
  const eventDate = new Date(event.date);
  const formattedDate = eventDate.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const formattedTime = eventDate.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div className="space-y-6">
      {/* Breadcrumb Navigation */}
      <div className="mx-6 pt-6">
        <Link href="/dashboard/events" className="inline-flex items-center gap-2 text-sm text-indigo-600 hover:text-indigo-700 font-medium">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to Events
        </Link>
      </div>

      {/* Header with Title and Actions */}
      <div className="mx-6">
        <div className="flex flex-col md:flex-row md:justify-between md:items-start gap-4">
          <div className="flex-1 min-w-0">
            <h1 className="text-3xl font-semibold text-slate-900 break-words">{event.name}</h1>
            <p className="text-slate-500 mt-2">{event.description}</p>
          </div>

          <div className="flex gap-3 flex-shrink-0 w-full md:w-auto">
            {/* Register button - only show for participants/applicants, not organizers/admins */}
            {session && !['admin', 'organizer'].includes(session.user.role) ? (
              <button
                className="flex-1 md:flex-none px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 font-medium transition-colors text-sm"
                onClick={() => router.push(`/register/${event.id}`)}
              >
                Register
              </button>
            ) : !session && (
              <Link
                href="/auth/signin"
                className="flex-1 md:flex-none px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 font-medium transition-colors text-sm text-center"
              >
                Sign In
              </Link>
            )}

            {session?.user?.role && ['admin', 'organizer', 'volunteer'].includes(session.user.role) && (
              <Link
                href={`/dashboard/events/${event.id}/registrations`}
                className="flex-1 md:flex-none px-4 py-2 bg-indigo-100 text-indigo-700 rounded-lg hover:bg-indigo-200 font-medium transition-colors text-sm text-center"
              >
                Registrations
              </Link>
            )}
          </div>
        </div>
      </div>

      {/* Event Info Cards */}
      <div className="mx-6 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5 space-y-2">
          <p className="text-xs uppercase tracking-wide font-medium text-slate-500">Date & Time</p>
          <p className="text-lg font-semibold text-slate-900">{formattedDate}</p>
          <p className="text-sm text-slate-600">at {formattedTime}</p>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5 space-y-2">
          <p className="text-xs uppercase tracking-wide font-medium text-slate-500">Location</p>
          <p className="text-lg font-semibold text-slate-900">{event.location}</p>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5 space-y-2">
          <p className="text-xs uppercase tracking-wide font-medium text-slate-500">Registration Status</p>
          <div className="flex items-center gap-2">
            <span className={`inline-block w-2.5 h-2.5 rounded-full ${event.isRegistrationOpen ? 'bg-emerald-500' : 'bg-rose-500'}`}></span>
            <span className="text-lg font-semibold text-slate-900">
              {event.isRegistrationOpen ? 'Open' : 'Closed'}
            </span>
          </div>
        </div>
      </div>

      {/* Team Management & Scoring - Only for Organizers/Admins */}
      {session?.user?.role && ['admin', 'organizer'].includes(session.user.role) && (
        <div className="mx-6 bg-white border border-slate-200 rounded-2xl shadow-sm p-6">
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-slate-900">Team Management</h2>
            <p className="text-sm text-slate-500 mt-1">
              Manage team formation, scoring rounds, and view team leaderboards
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Link
              href={`/dashboard/team-management/${event.id}`}
              className="flex items-center justify-between px-4 py-3 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
            >
              <span className="font-medium text-slate-900">Team Formation</span>
              <svg className="w-5 h-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </Link>
            <Link
              href={`/dashboard/team-scores/${event.id}`}
              className="flex items-center justify-between px-4 py-3 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
            >
              <span className="font-medium text-slate-900">Scores & Rounds</span>
              <svg className="w-5 h-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </Link>
            <Link
              href={`/dashboard/tally/${event.id}`}
              className="flex items-center justify-between px-4 py-3 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
            >
              <span className="font-medium text-slate-900">Final Tally</span>
              <svg className="w-5 h-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          </div>
        </div>
      )}

      {session?.user?.role === 'admin' && <EventVolunteers key={event.id} eventId={event.id} />}

      {/* Checkpoint Access Control - Only for Organizers/Admins */}
      {session?.user?.role && ['admin', 'organizer'].includes(session.user.role) &&
        event.checkpoints && event.checkpoints.length > 0 && (
          <div className="mx-6 bg-white border border-slate-200 rounded-2xl shadow-sm p-6 space-y-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Checkpoint Access Control</h2>
              <p className="text-sm text-slate-500 mt-1">
                Start or stop checkpoints manually, regardless of event dates. Stopped checkpoints cannot accept scans. Only one non-registration checkpoint can be active at a time.
              </p>
            </div>

            <div className="space-y-3">
              {event.checkpoints.map((checkpoint, idx) => {
                const isUnlocked = event.unlockedCheckpoints?.includes(checkpoint) ?? false;

                return (
                  <div
                    key={checkpoint}
                    className="flex items-center p-4 border border-slate-200 rounded-xl hover:bg-slate-50 cursor-pointer transition-colors"
                  >
                    <div className="ml-4 flex-1">
                      <div className="flex items-center gap-3">
                        <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-indigo-100 text-sm font-semibold text-indigo-700">
                          {idx + 1}
                        </span>
                        <div>
                          <span className="font-medium text-slate-900">{checkpoint}</span>
                          <span className={`ml-3 text-sm font-medium ${isUnlocked ? 'text-emerald-600' : 'text-slate-500'}`}>
                            {isUnlocked ? 'Started' : 'Stopped'}
                          </span>
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={() => handleCheckpointToggle(checkpoint, isUnlocked)}
                      disabled={!!actionLoading}
                      aria-label={`${isUnlocked ? 'Stop' : 'Start'} ${checkpoint}`}
                      className={`px-4 py-2 rounded-lg text-white disabled:opacity-50 ${isUnlocked ? 'bg-rose-600 hover:bg-rose-700' : 'bg-emerald-600 hover:bg-emerald-700'}`}
                    >
                      {actionLoading === checkpoint ? 'Updating...' : isUnlocked ? 'Stop' : 'Start'}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

      {/* Registration Control - Only for Organizers/Admins */}
      {session?.user?.role && ['admin', 'organizer'].includes(session.user.role) && (
        <div className="mx-6 bg-white border border-slate-200 rounded-2xl shadow-sm p-6 space-y-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Registration Control</h2>
            <p className="text-sm text-slate-500 mt-1">
              Open or close registration for applicants to join this event.
            </p>
          </div>

          <label className="flex items-center p-4 border-2 border-indigo-200 bg-indigo-50 rounded-xl cursor-pointer">
            <input
              type="checkbox"
              checked={event.isRegistrationOpen ?? true}
              onChange={() => handleRegistrationToggle(event.isRegistrationOpen ?? true)}
              className="h-5 w-5 text-indigo-600 rounded focus:ring-2 focus:ring-indigo-500 cursor-pointer"
            />
            <div className="ml-4 flex-1">
              <span className="font-semibold text-slate-900">Accept New Registrations</span>
              <span className={`ml-3 text-sm font-medium ${event.isRegistrationOpen ?? true ? 'text-emerald-600' : 'text-rose-600'}`}>
                {event.isRegistrationOpen ?? true ? 'Open' : 'Closed'}
              </span>
            </div>
          </label>

          <label className="flex items-center p-4 border-2 border-purple-200 bg-purple-50 rounded-xl cursor-pointer">
            <input
              type="checkbox"
              checked={event.isTeamFormationOpen ?? false}
              onChange={() => handleTeamFormationToggle(event.isTeamFormationOpen ?? false)}
              className="h-5 w-5 text-purple-600 rounded focus:ring-2 focus:ring-purple-500 cursor-pointer"
            />
            <div className="ml-4 flex-1">
              <span className="font-semibold text-slate-900">Form Teams</span>
              <span className={`ml-3 text-sm font-medium ${event.isTeamFormationOpen ?? false ? 'text-emerald-600' : 'text-rose-600'}`}>
                {event.isTeamFormationOpen ?? false ? 'Open' : 'Closed'}
              </span>
            </div>
          </label>
        </div>
      )}

      {/* Pending Registrations Section for Organizers/Admins */}
      {session?.user?.role && ['admin', 'organizer'].includes(session.user.role) && pendingRegistrations.length > 0 && (
        <div className="mx-6 bg-white border border-slate-200 rounded-2xl shadow-sm p-6 space-y-4">
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-amber-100 text-sm font-semibold text-amber-700">
              {pendingRegistrations.length}
            </span>
            <h2 className="text-lg font-semibold text-slate-900">Pending Registrations</h2>
          </div>

          {loadingPending ? (
            <div className="text-slate-500">Loading pending registrations...</div>
          ) : (
            <div className="space-y-3">
              {pendingRegistrations.map((registration) => (
                <div key={registration.id} className="border border-amber-200 bg-amber-50 rounded-xl p-4 space-y-3">
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <h3 className="font-semibold text-slate-900">{registration.userName}</h3>
                      <p className="text-sm text-slate-600">{registration.userEmail}</p>
                      <p className="text-xs text-slate-500 mt-1">
                        Applied: {new Date(registration.createdAt).toLocaleDateString()} at {new Date(registration.createdAt).toLocaleTimeString()}
                      </p>

                      {/* Show registration responses */}
                      {registration.responses && Object.keys(registration.responses).length > 0 && (
                        <div className="mt-3 pt-3 border-t border-amber-200 space-y-2">
                          {Object.entries(registration.responses).map(([key, value]) => (
                            <div key={key} className="text-sm">
                              <span className="font-medium text-slate-700">{key}</span>
                              <span className="text-slate-600"> {String(value)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex gap-2 pt-3 border-t border-amber-200">
                    <button
                      onClick={() => handleApprove(registration.id)}
                      disabled={actionLoading === registration.id}
                      className="flex-1 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium text-sm transition-colors"
                    >
                      {actionLoading === registration.id ? 'Approving...' : 'Approve'}
                    </button>
                    <button
                      onClick={() => handleReject(registration.id)}
                      disabled={actionLoading === registration.id}
                      className="flex-1 px-4 py-2 bg-rose-600 text-white rounded-lg hover:bg-rose-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium text-sm transition-colors"
                    >
                      {actionLoading === registration.id ? 'Rejecting...' : 'Reject'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Registration Form */}
      <div className="mx-6 bg-white border border-slate-200 rounded-2xl shadow-sm p-6 space-y-4">
        <h2 className="text-lg font-semibold text-slate-900">Registration Form</h2>

        {event.formSchema?.fields ? (
          <>
            <p className="text-slate-600 text-sm">
              Participants complete these fields when registering:
            </p>

            <div className="space-y-2">
              {event.formSchema.fields.map((field) => (
                <div key={field.id} className="p-3 border border-slate-200 rounded-lg">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-slate-900">{field.label}</p>
                      <p className="text-xs text-slate-500 mt-1">
                        {field.type} · {field.required ? 'Required' : 'Optional'}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex gap-3 pt-4 border-t border-slate-100">
              <button
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-medium text-sm transition-colors"
                onClick={() => router.push(`/register/${event.id}`)}
              >
                Preview Registration
              </button>
            </div>
          </>
        ) : (
          <p className="text-slate-600">No registration form configured for this event.</p>
        )}
      </div>
    </div>
  );
}
