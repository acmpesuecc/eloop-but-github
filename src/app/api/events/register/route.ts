import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getEventById } from '@/lib/db/event';
import { createRegistration } from '@/lib/db/registration';
import { generateQRCodeForStorage } from '@/lib/qr';

// Register for an event
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

    if (session.user.role !== 'applicant') {
      return NextResponse.json({ error: 'Only applicants can register for events.' }, { status: 403 });
    }
    
    // Parse request body
    const body = await request.json();
    const { eventId, responses } = body;
    
    if (!eventId || !responses) {
      return NextResponse.json(
        { error: 'Event ID and responses are required' },
        { status: 400 }
      );
    }
    
    // Get event to validate form responses
    const event = await getEventById(eventId);
    
    if (!event) {
      return NextResponse.json(
        { error: 'Event not found' },
        { status: 404 }
      );
    }
    
    // If the organizer has explicitly closed registrations, reject.
    // Otherwise, allow registration even if registrationCloseDate has passed
    // so organizers can re-open registrations after the deadline by toggling.
    if (event.isRegistrationOpen === false) {
      return NextResponse.json(
        { error: 'Registration is currently closed for this event' },
        { status: 400 }
      );
    }
    
    // Validate required fields
    const requiredFields = event.formSchema.fields
      .filter(field => field.required)
      .map(field => field.name);
    
    const missingFields = requiredFields.filter(fieldName => !responses[fieldName]);
    
    if (missingFields.length > 0) {
      return NextResponse.json(
        { 
          error: 'Missing required fields',
          missingFields
        },
        { status: 400 }
      );
    }
    
    // Generate QR code for check-in
    const qrCode = await generateQRCodeForStorage(session.user.id, eventId);
    
    // Create registration
    const registration = await createRegistration({
      eventId,
      userId: session.user.id,
      responses,
      qrCode,
      checkpointCheckIns: []
    });
    
    return NextResponse.json({
      success: true,
      registration: {
        id: registration.id,
        eventId: registration.eventId,
        status: registration.status,
        createdAt: registration.createdAt
      }
    });
  } catch (error) {
    console.error('Event registration error:', error);
    return NextResponse.json(
      { error: 'Failed to register for event' },
      { status: 500 }
    );
  }
}
