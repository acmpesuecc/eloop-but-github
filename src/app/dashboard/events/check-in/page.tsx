'use client';

import { useState, useEffect, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { GenericQRScanner } from '@/components/qr/GenericQRScanner';
import { Check, X, RefreshCw, User, Calendar, MapPin, AlertTriangle } from 'lucide-react';

interface CheckpointCheckIn {
  checkpoint: string;
  checkedInBy: string;
  checkedInAt: string;
}

interface CheckInResponse {
  success: boolean;
  requiresApproval?: boolean;
  skippedCheckpoints?: string[];
  user?: {
    id: string;
    name: string;
    email: string;
  };
  registration?: {
    id: string;
    eventId: string;
    eventName?: string;
    userId: string;
    status: 'registered' | 'checked-in';
    responses: Record<string, unknown>;
    checkedInAt?: Date;
    checkpointCheckIns?: CheckpointCheckIn[];
  };
  error?: string;
}

export default function CheckInPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const [isScanning, setIsScanning] = useState(true);
  const [scanResult, setScanResult] = useState<CheckInResponse | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [pendingApproval, setPendingApproval] = useState<{
    qrToken: string;
    checkpoint: string;
    skippedCheckpoints: string[];
    user?: CheckInResponse['user'];
  } | null>(null);
  const approvalDialogRef = useRef<HTMLDialogElement | null>(null);
  const processingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [recentCheckIns, setRecentCheckIns] = useState<CheckInResponse[]>([]);
  const [selectedCheckpoint, setSelectedCheckpoint] = useState<string>('');
  const [availableCheckpoints, setAvailableCheckpoints] = useState<string[]>([]);
  const [loadingCheckpoints, setLoadingCheckpoints] = useState(true);
  const [selectedEvent, setSelectedEvent] = useState<string>('');
  const [availableEvents, setAvailableEvents] = useState<Array<{
    id: string,
    name: string,
    checkpoints: string[],
    unlockedCheckpoints: string[]
  }>>([]);
  const [autoScanEnabled, setAutoScanEnabled] = useState(false);
  const [scannerKey, setScannerKey] = useState(0);
  const isOrganizer = session?.user?.role === 'organizer' || session?.user?.role === 'admin';
  const [lastCheckpointUpdate, setLastCheckpointUpdate] = useState<string>('');
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Audio refs for sound effects
  const successSoundRef = useRef<HTMLAudioElement | null>(null);
  const errorSoundRef = useRef<HTMLAudioElement | null>(null);

  // Initialize audio on mount
  useEffect(() => {
    // Create success sound (higher pitch beep)
    const successAudio = new Audio();
    successAudio.src = 'data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBTGH0fPTgjMGHm7A7+OZURE=';
    successSoundRef.current = successAudio;

    // Create error sound (lower pitch buzz)
    const errorAudio = new Audio();
    errorAudio.src = 'data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACAgoSCfXp6fYGEhIN/e3t/hIiIhH99fYCEiIiFgn5+gYWIiIWCfn6BhYiIhYJ+foGFiIiFgn5+gYWIiIWCfn6BhYiIhYJ+foGFiIiFgn5+gYWIiIWCfn6BhYiIhYJ+foGFiIiFgn5+gYWIiIWCfn6BhYiIhYJ+foGFiIiFgn5+gYWIiIWCfn6BhYiIhYJ+';
    errorSoundRef.current = errorAudio;
  }, []);

  // Fetch available events and their checkpoints
  useEffect(() => {
    const fetchEvents = async () => {
      try {
        const response = await fetch('/api/events');
        if (!response.ok) throw new Error('Failed to fetch events');

        const data = await response.json();
        const events = data.events || data;

        if (events && events.length > 0) {
          // Store all events with their checkpoints and unlocked checkpoints
          const eventList = events.map((event: {
            id: string,
            name: string,
            checkpoints?: string[],
            unlockedCheckpoints?: string[]
          }) => ({
            id: event.id,
            name: event.name,
            checkpoints: event.checkpoints || ['Checkin'],
            unlockedCheckpoints: event.unlockedCheckpoints || []
          }));

          setAvailableEvents(eventList);

          // Auto-select first event
          setSelectedEvent(eventList[0].id);

          // Volunteers: only show unlocked checkpoints
          // Organizers: show all checkpoints that are currently unlocked as well.
          const checkpointsToShow = eventList[0].unlockedCheckpoints;

          setAvailableCheckpoints(checkpointsToShow);
          setSelectedCheckpoint(checkpointsToShow[0] || '');
        } else {
          // Fallback to default
          setAvailableCheckpoints([]);
          setSelectedCheckpoint('');
        }
      } catch (err) {
        console.error('Error fetching events:', err);
        // Fallback to default checkpoints
        setAvailableCheckpoints([]);
        setSelectedCheckpoint('');
      } finally {
        setLoadingCheckpoints(false);
      }
    };

    fetchEvents();
  }, [isOrganizer]);

  // Poll for checkpoint updates (for volunteers only previously; now for all scanner roles)
  useEffect(() => {
    if (!selectedEvent) return;

    const pollCheckpoints = async () => {
      try {
        const response = await fetch(`/api/events/${selectedEvent}`);
        if (!response.ok) return;

        const data = await response.json();
        const event = data.event;

        const currentCheckpoints = JSON.stringify(event.unlockedCheckpoints || []);

        // If checkpoints changed, update UI and show notification
        const knownCheckpoints = lastCheckpointUpdate || JSON.stringify(
          availableEvents.find(e => e.id === selectedEvent)?.unlockedCheckpoints || []
        );
        if (knownCheckpoints !== currentCheckpoints) {
          setAvailableEvents(previous => previous.map(availableEvent => availableEvent.id === selectedEvent
            ? { ...availableEvent, unlockedCheckpoints: event.unlockedCheckpoints || [] }
            : availableEvent));

          setAvailableCheckpoints(event.unlockedCheckpoints || []);
          setSelectedCheckpoint(previous => (event.unlockedCheckpoints || []).includes(previous)
            ? previous : event.unlockedCheckpoints?.[0] || '');

          // Visual feedback for checkpoint change
          playSuccessSound();
        }

        setLastCheckpointUpdate(currentCheckpoints);
      } catch (err) {
        console.error('Error polling checkpoints:', err);
      }
    };

    // Initial poll
    pollCheckpoints();

    // Poll every 3 seconds
    pollingIntervalRef.current = setInterval(pollCheckpoints, 3000);

    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
      }
    };
  }, [isOrganizer, selectedEvent, lastCheckpointUpdate, availableEvents]);

  // Update checkpoints when event selection changes
  const handleEventChange = (eventId: string) => {
    setSelectedEvent(eventId);
    const event = availableEvents.find(e => e.id === eventId);
    if (event) {
      // Volunteers: only show unlocked checkpoints
      // Organizers: show all checkpoints that are currently unlocked as well.
      const checkpointsToShow = event.unlockedCheckpoints;

      setAvailableCheckpoints(checkpointsToShow);
      setSelectedCheckpoint(checkpointsToShow[0] || '');
      // Reset scanner with new key when changing events (this will reset camera)
      setScannerKey(prev => prev + 1);
      // Reset polling state for new event
      setLastCheckpointUpdate('');
    }
  };

  // Verify user has proper permissions (volunteers, organizers, admins only)
  useEffect(() => {
    if (session && session.user) {
      const userRole = session.user.role;
      // Redirect participants back to their dashboard
      if (userRole === 'participant') {
        router.push('/dashboard');
        return;
      }
      // Block other unauthorized roles
      if (userRole !== 'admin' && userRole !== 'organizer' && userRole !== 'volunteer') {
        router.push('/dashboard');
      }
    }
  }, [session, router]);

  const playSuccessSound = () => {
    if (successSoundRef.current) {
      successSoundRef.current.currentTime = 0;
      successSoundRef.current.play().catch(e => console.log('Audio play failed:', e));
    }
  };

  const playErrorSound = () => {
    if (errorSoundRef.current) {
      // Play error sound 3 times with short delays
      const playBeep = (count: number) => {
        if (count > 0 && errorSoundRef.current) {
          errorSoundRef.current.currentTime = 0;
          errorSoundRef.current.play().catch(e => console.log('Audio play failed:', e));
          setTimeout(() => playBeep(count - 1), 200); // 200ms between beeps
        }
      };
      playBeep(3);
    }
  };

  useEffect(() => {
    if (pendingApproval) {
      approvalDialogRef.current?.showModal();
    } else {
      approvalDialogRef.current?.close();
    }
  }, [pendingApproval]);

  const handleScan = async (
    qrData: string,
    checkpoint = selectedCheckpoint,
    approveSkippedCheckpoints = false
  ) => {
    if (!checkpoint || processingRef.current || (pendingApproval && !approveSkippedCheckpoints)) return;
    processingRef.current = true;

    try {
      setIsProcessing(true);
      setPendingApproval(null);
      setError(null);
      setScanResult(null);
      setIsScanning(false);

      // Call the check-in API with checkpoint
      const response = await fetch('/api/events/check-in', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          qrToken: qrData,
          checkpoint,
          approveSkippedCheckpoints
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || 'Failed to process check-in');
        playErrorSound();
        return;
      }

      if (data.requiresApproval) {
        setPendingApproval({
          qrToken: qrData,
          checkpoint,
          skippedCheckpoints: data.skippedCheckpoints,
          user: data.user
        });
        return;
      }

      // Show success
      setScanResult(data);
      playSuccessSound();

      // Add to recent check-ins
      setRecentCheckIns(prev => [data, ...prev.slice(0, 4)]);
    } catch (err) {
      const errorMsg = 'Failed to process QR code: ' + (err instanceof Error ? err.message : String(err));
      setError(errorMsg);
      playErrorSound();
    } finally {
      processingRef.current = false;
      setIsProcessing(false);
    }
  };

  // Reset scanner
  const resetScanner = () => {
    setPendingApproval(null);
    setIsScanning(true);
    setScanResult(null);
    setError(null);
  };

  // Auto-scan: automatically restart scanning after successful check-in
  useEffect(() => {
    if (autoScanEnabled && scanResult?.success && !isScanning) {
      const timer = setTimeout(() => {
        resetScanner();
      }, 2000); // Wait 2 seconds after successful scan before restarting

      return () => clearTimeout(timer);
    }
  }, [autoScanEnabled, scanResult, isScanning]);

  if (!session?.user) {
    return <div className="p-6 text-center">Loading...</div>;
  }

  return (
    <div className="mx-6 py-6 max-w-7xl">
      <dialog
        ref={approvalDialogRef}
        aria-labelledby="skipped-checkpoints-title"
        aria-describedby="skipped-checkpoints-description"
        onCancel={resetScanner}
        className="m-auto w-full max-w-md rounded-2xl border border-amber-200 bg-white p-6 shadow-xl backdrop:bg-black/50"
      >
        {pendingApproval && (
          <>
            <AlertTriangle className="w-10 h-10 text-amber-600 mb-3" aria-hidden="true" />
            <h2 id="skipped-checkpoints-title" className="text-xl font-semibold text-slate-900 mb-2">
              Skipped Checkpoints
            </h2>
            <p id="skipped-checkpoints-description" className="text-sm text-slate-600">
              {pendingApproval.user?.name || 'This participant'} has skipped checkpoints.
              Press Approve to check them in at {pendingApproval.checkpoint} anyway.
              Skipped checkpoints will remain unscanned.
            </p>
            <ul className="list-disc pl-5 my-4 text-sm text-amber-800">
              {pendingApproval.skippedCheckpoints.map(checkpoint => <li key={checkpoint}>{checkpoint}</li>)}
            </ul>
            <div className="flex justify-end gap-3">
              <button autoFocus onClick={resetScanner} className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50">
                Cancel
              </button>
              <button
                onClick={() => handleScan(pendingApproval.qrToken, pendingApproval.checkpoint, true)}
                disabled={isProcessing}
                className="px-4 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                Approve
              </button>
            </div>
          </>
        )}
      </dialog>
      <div className="mb-6">
        <h1 className="text-3xl font-semibold text-slate-900">Check-In Scanner</h1>
        <p className="text-slate-500 mt-1">Scan participant QR codes to check them into the event</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Controls */}
        <div className="space-y-5">
          {/* Event Selector */}
          {availableEvents.length > 1 && (
            <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5">
              <label className="block text-sm font-medium text-slate-700 mb-3">
                <Calendar className="inline w-4 h-4 mr-1.5 text-indigo-600" />
                Event
              </label>
              <select
                value={selectedEvent}
                onChange={(e) => handleEventChange(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-colors"
              >
                {availableEvents.map(event => (
                  <option key={event.id} value={event.id}>
                    {event.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Checkpoint Selector */}
          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5">
            <label className="block text-sm font-medium text-slate-700 mb-3">
              <MapPin className="inline w-4 h-4 mr-1.5 text-indigo-600" />
              Active Checkpoint
            </label>
            {loadingCheckpoints ? (
              <div className="text-center py-8">
                <div className="animate-pulse text-slate-400">Loading...</div>
              </div>
            ) : availableCheckpoints.length === 0 ? (
              <div className="text-center py-6 px-4 bg-slate-50 rounded-xl">
                <p className="text-slate-600 text-sm">No checkpoints available</p>
                <p className="text-xs text-slate-400 mt-1">Waiting for an admin or the event organizer to start a checkpoint</p>
              </div>
            ) : (
              <div className="space-y-3">
                {availableCheckpoints.map((checkpoint, index) => (
                  <button
                    key={checkpoint}
                    onClick={() => setSelectedCheckpoint(checkpoint)}
                    className={`w-full px-4 py-3 rounded-xl font-medium transition-all flex items-center gap-3 ${selectedCheckpoint === checkpoint
                        ? 'bg-indigo-600 text-white shadow-sm'
                        : 'bg-slate-50 text-slate-700 hover:bg-slate-100 border border-slate-200'
                      }`}
                  >
                    <span className={`flex items-center justify-center w-7 h-7 rounded-lg text-sm font-semibold ${selectedCheckpoint === checkpoint
                        ? 'bg-indigo-700 text-white'
                        : 'bg-slate-200 text-slate-700'
                      }`}>
                      {index + 1}
                    </span>
                    <span className="flex-1 text-left">{checkpoint}</span>
                    {selectedCheckpoint === checkpoint && (
                      <Check className="w-5 h-5" />
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Auto-Scan Toggle */}
          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5">
            <label className="flex items-start cursor-pointer">
              <div className="relative mt-0.5">
                <input
                  type="checkbox"
                  checked={autoScanEnabled}
                  onChange={(e) => setAutoScanEnabled(e.target.checked)}
                  className="sr-only"
                />
                <div className={`block w-11 h-6 rounded-full transition ${autoScanEnabled ? 'bg-emerald-600' : 'bg-slate-300'
                  }`}></div>
                <div className={`absolute left-0.5 top-0.5 bg-white w-5 h-5 rounded-full transition-transform ${autoScanEnabled ? 'transform translate-x-5' : ''
                  }`}></div>
              </div>
              <div className="ml-3 flex-1">
                <span className="text-sm font-medium text-slate-900">Auto-Scan Mode</span>
                <p className="text-xs text-slate-500 mt-0.5">Automatically scan next participant after 2 seconds</p>
              </div>
            </label>
          </div>

          {/* Info Badge */}
          {selectedCheckpoint && (
            <div className="bg-amber-50 border border-amber-200 rounded-2xl shadow-sm p-4">
              <p className="text-xs text-amber-700 flex items-start gap-2">
                <span className="text-base">⚠️</span>
                <span className="flex-1">Skipped checkpoints require approval on the scanner before check-in.</span>
              </p>
            </div>
          )}
        </div>

        {/* Center Column: Scanner */}
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5 relative">
          {/* Scanner - always mounted to preserve camera selection */}
          <div className={isScanning ? '' : 'hidden'}>
            <GenericQRScanner
              key={scannerKey}
              onScan={(qrData) => handleScan(qrData)}
              scannerTitle="Check-In Scanner"
              scannerDescription="Position QR code within frame"
              isActive={isScanning && !!selectedCheckpoint}
            />
          </div>

          {/* Results overlay - shown on top of scanner */}
          {!isScanning && (
            <div className="py-2">
              {isProcessing ? (
                <div className="text-center py-12">
                  <div className="animate-spin w-12 h-12 border-4 border-indigo-600 border-t-transparent rounded-full mx-auto mb-4"></div>
                  <p className="text-slate-600 font-medium">Processing...</p>
                </div>
              ) : error ? (
                <div className="text-center py-8">
                  <div className="bg-rose-100 rounded-full w-16 h-16 flex items-center justify-center mx-auto mb-4">
                    <X className="text-rose-600 w-8 h-8" />
                  </div>
                  <h2 className="text-xl font-semibold mb-2 text-slate-900">Check-In Failed</h2>
                  <p className="text-rose-600 mb-6 text-sm">{error}</p>
                  <button
                    onClick={resetScanner}
                    className="px-4 py-2.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 inline-flex items-center gap-2 font-medium transition-colors"
                  >
                    <RefreshCw className="w-4 h-4" /> Scan Again
                  </button>
                </div>
              ) : scanResult?.success ? (
                <div className="text-center py-8">
                  <div className="bg-emerald-100 rounded-full w-16 h-16 flex items-center justify-center mx-auto mb-4">
                    <Check className="text-emerald-600 w-8 h-8" />
                  </div>
                  <h2 className="text-xl font-semibold mb-4 text-emerald-600">Check-In Successful</h2>

                  {scanResult.user && (
                    <div className="mb-6 p-4 bg-slate-50 rounded-xl border border-slate-200">
                      <div className="flex items-center justify-center mb-2">
                        <User className="w-5 h-5 mr-2 text-slate-600" />
                        <p className="font-semibold text-lg text-slate-900">{scanResult.user.name}</p>
                      </div>
                      <p className="text-sm text-slate-500">{scanResult.user.email}</p>
                    </div>
                  )}

                  <button
                    onClick={resetScanner}
                    className="px-4 py-2.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 inline-flex items-center gap-2 font-medium transition-colors"
                  >
                    <RefreshCw className="w-4 h-4" /> Scan Next
                  </button>
                </div>
              ) : null}
            </div>
          )}
        </div>

        {/* Right Column: Recent Check-ins */}
        <div>
          <h2 className="text-lg font-semibold text-slate-900 mb-4">Recent Check-Ins</h2>

          {recentCheckIns.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-8 text-center">
              <div className="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-3">
                <User className="w-6 h-6 text-slate-400" />
              </div>
              <p className="text-slate-600 text-sm">No recent check-ins</p>
              <p className="text-xs text-slate-400 mt-1">Scanned participants will appear here</p>
            </div>
          ) : (
            <div className="space-y-3">
              {recentCheckIns.map((checkIn, index) => (
                <div key={index} className="bg-white border border-slate-200 rounded-2xl shadow-sm p-4 border-l-4 border-l-emerald-500">
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <User className="w-4 h-4 text-slate-500 flex-shrink-0" />
                        <h3 className="font-semibold text-slate-900 truncate">{checkIn.user?.name}</h3>
                      </div>
                      <p className="text-sm text-slate-500 truncate mb-2">{checkIn.user?.email}</p>

                      {checkIn.registration?.eventName && (
                        <div className="flex items-center text-xs text-slate-500 mb-2">
                          <Calendar className="w-3.5 h-3.5 mr-1 flex-shrink-0" />
                          <span className="truncate">{checkIn.registration.eventName}</span>
                        </div>
                      )}

                      {/* Checkpoint History */}
                      {checkIn.registration?.checkpointCheckIns && checkIn.registration.checkpointCheckIns.length > 0 && (
                        <div className="mt-3 pt-3 border-t border-slate-200">
                          <p className="text-xs font-medium text-slate-700 mb-2 flex items-center gap-1">
                            <MapPin className="w-3 h-3" />
                            Checkpoints:
                          </p>
                          <div className="space-y-1.5">
                            {checkIn.registration.checkpointCheckIns.map((cp, cpIndex) => (
                              <div key={cpIndex} className="text-xs flex items-center justify-between bg-slate-50 px-2.5 py-1.5 rounded-lg">
                                <span className="font-medium text-slate-700">{cp.checkpoint}</span>
                                <span className="text-slate-500">
                                  {new Date(cp.checkedInAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700 ml-3 flex-shrink-0">
                      ✓ Done
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
