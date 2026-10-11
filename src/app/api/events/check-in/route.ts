import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { checkInParticipantAtCheckpoint, rowToRegistration } from '@/lib/db/registration';
import { turso } from '@/lib/db/client';
import { verifyQRCode } from '@/lib/qr';
import { hasVolunteerPrivileges, getUserById } from '@/lib/db/user';
import { getEventById } from '@/lib/db/event';
import crypto from 'crypto';

// Check in a participant
export async function POST(request: Request) {
  try {
    const session = await auth();
    
    // User must be logged in
    if (!session?.user) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }
    
    // Only volunteers, organizers, or admins can check in participants
    const canCheckIn = await hasVolunteerPrivileges(session.user.id);
    if (!canCheckIn) {
      return NextResponse.json(
        { error: 'Volunteer privileges required' },
        { status: 403 }
      );
    }
    
    // Parse request body
    const body = await request.json();
    const { qrToken, checkpoint, approveSkippedCheckpoints } = body;
    
    if (!qrToken) {
      return NextResponse.json(
        { error: 'QR token is required' },
        { status: 400 }
      );
    }

    if (!checkpoint) {
      return NextResponse.json(
        { error: 'Checkpoint is required' },
        { status: 400 }
      );
    }
    
    // Decode and verify the QR JWT
    const qrData = await verifyQRCode(qrToken);
    if (!qrData) {
      await logScanAttempt({
        eventId: 'unknown',
        volunteerId: session.user.id,
        qrCode: qrToken,
        checkpoint,
        scanStatus: 'invalid_qr',
        errorMessage: 'Invalid or tampered QR code'
      });
      return NextResponse.json(
        { error: 'Invalid or tampered QR code' },
        { status: 400 }
      );
    }

    // Look up registration by QR token
    const registration = await findRegistrationByQRToken(qrToken, qrData.eventId);
    if (!registration) {
      await logScanAttempt({
        eventId: qrData.eventId,
        volunteerId: session.user.id,
        qrCode: qrToken,
        checkpoint,
        scanStatus: 'not_found',
        errorMessage: 'Registration not found or QR data mismatch'
      });
      return NextResponse.json(
        { error: 'Registration not found or QR data mismatch' },
        { status: 404 }
      );
    }

    // Get event to check checkpoint order
    const event = await getEventById(registration.eventId);
    if (!event) {
      return NextResponse.json(
        { error: 'Event not found' },
        { status: 404 }
      );
    }

    const checkpoints = event.checkpoints || [];
    const checkpointCheckIns = registration.checkpointCheckIns || [];

    // Check if already checked in at this specific checkpoint
    const alreadyCheckedInHere = checkpointCheckIns.some(c => c.checkpoint === checkpoint);
    if (alreadyCheckedInHere) {
      const user = await getUserById(registration.userId);
      await logScanAttempt({
        eventId: registration.eventId,
        volunteerId: session.user.id,
        qrCode: qrToken,
        checkpoint,
        scanStatus: 'already_checked_in',
        errorMessage: `Already checked in at ${checkpoint}`,
        userId: registration.userId,
        registrationId: registration.id
      });
      return NextResponse.json(
        { 
          error: `Already checked in at ${checkpoint}`,
          user: user ? { id: user.id, name: user.name, email: user.email } : undefined,
          registration: {
            ...registration,
            eventName: event.name,
            checkpointCheckIns
          }
        },
        { status: 409 }
      );
    }

    // Validate that checkpoint exists in event's checkpoint list
    if (!checkpoints.includes(checkpoint)) {
      return NextResponse.json(
        { error: `Invalid checkpoint: ${checkpoint} is not part of this event` },
        { status: 400 }
      );
    }

    // Approval of skipped checkpoints must not bypass registration approval.
    // Manual checkpoint state applies to every scanner, including admins.
    if (!event.unlockedCheckpoints?.includes(checkpoint)) {
      return NextResponse.json(
        { error: `Checkpoint is stopped: ${checkpoint}. Ask an admin or the event organizer to start it.` },
        { status: 403 }
      );
    }

    if (registration.status !== 'approved' && registration.status !== 'checked-in') {
      return NextResponse.json(
        { error: 'Registration must be approved before check-in' },
        { status: 403 }
      );
    }

    const skippedCheckpoints = checkpoints
      .slice(0, checkpoints.indexOf(checkpoint))
      .filter(previous => !checkpointCheckIns.some(checkIn => checkIn.checkpoint === previous));

    if (skippedCheckpoints.length > 0 && approveSkippedCheckpoints !== true) {
      const user = await getUserById(registration.userId);
      return NextResponse.json({
        success: false,
        requiresApproval: true,
        skippedCheckpoints,
        checkpoint,
        user: user ? { id: user.id, name: user.name, email: user.email } : undefined,
        registration: { ...registration, eventName: event.name }
      });
    }

    const updatedRegistration = await checkInParticipantAtCheckpoint(
      registration.qrCode, 
      checkpoint, 
      session.user.id
    );
    
    if (!updatedRegistration) {
      return NextResponse.json(
        { error: 'Failed to update registration' },
        { status: 500 }
      );
    }

    // Log successful check-in
    await logScanAttempt({
      eventId: registration.eventId,
      volunteerId: session.user.id,
      qrCode: qrToken,
      checkpoint,
      scanStatus: 'success',
      errorMessage: skippedCheckpoints.length > 0
        ? `Skipped checkpoints approved: ${skippedCheckpoints.join(', ')}`
        : undefined,
      userId: registration.userId,
      registrationId: registration.id
    });

    // Get user details for response (event already fetched above)
    const user = await getUserById(registration.userId);

    return NextResponse.json({
      success: true,
      user: user ? { id: user.id, name: user.name, email: user.email } : undefined,
      registration: {
        ...updatedRegistration,
        eventName: event?.name,
        checkpointCheckIns: updatedRegistration.checkpointCheckIns || []
      }
    });

  } catch (error) {
    console.error('Check-in error:', error);
    
    // Try to log the error (may fail if we don't have required data)
    try {
      const session = await auth();
      if (session?.user) {
        const body = await request.clone().json();
        await logScanAttempt({
          eventId: 'unknown',
          volunteerId: session.user.id,
          qrCode: body.qrToken,
          checkpoint: body.checkpoint || 'unknown',
          scanStatus: 'error',
          errorMessage: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    } catch (logError) {
      console.error('Failed to log error scan:', logError);
    }
    
    return NextResponse.json(
      { error: 'Failed to check in participant' },
      { status: 500 }
    );
  }
}

// Helper to log scan attempts
async function logScanAttempt({
  eventId,
  volunteerId,
  qrCode,
  checkpoint,
  scanStatus,
  errorMessage,
  userId,
  registrationId
}: {
  eventId: string;
  volunteerId: string;
  qrCode?: string;
  checkpoint: string;
  scanStatus: 'success' | 'error' | 'invalid_qr' | 'not_found' | 'wrong_checkpoint' | 'already_checked_in';
  errorMessage?: string;
  userId?: string;
  registrationId?: string;
}) {
  try {
    await turso.execute({
      sql: `INSERT INTO scan_logs (id, event_id, volunteer_id, qr_code, checkpoint, scan_status, error_message, user_id, registration_id, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        crypto.randomUUID(),
        eventId,
        volunteerId,
        qrCode || null,
        checkpoint,
        scanStatus,
        errorMessage || null,
        userId || null,
        registrationId || null,
        Date.now()
      ]
    });
  } catch (error) {
    // Log error but don't fail the check-in request
    console.error('Failed to log scan attempt:', error);
  }
}

// Helper to find registration by QR token
async function findRegistrationByQRToken(qrToken: string, eventId: string) {
  const result = await turso.execute({
    sql: `SELECT * FROM registrations WHERE event_id = ? AND qr_code = ?`,
    args: [eventId, qrToken]
  });
  if (result.rows.length === 0) return null;
  return rowToRegistration(result.rows[0]);
}
