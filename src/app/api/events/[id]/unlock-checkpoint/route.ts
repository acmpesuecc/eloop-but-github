import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { unlockCheckpoint, lockCheckpoint, getEventById } from '@/lib/db/event';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await auth();
    const resolvedParams = await params;
    const eventId = resolvedParams.id;
    
    // User must be logged in and be an organizer or admin
    if (!session?.user) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }
    
    if (session.user.role !== 'admin' && session.user.role !== 'organizer') {
      return NextResponse.json(
        { error: 'Only organizers and admins can manage checkpoints' },
        { status: 403 }
      );
    }
    
    const body = await request.json();
    const { checkpoint, action } = body; // action: 'unlock' or 'lock'
    
    if (typeof checkpoint !== 'string' || !checkpoint.trim()) {
      return NextResponse.json(
        { error: 'Checkpoint is required' },
        { status: 400 }
      );
    }
    
    // Verify event exists
    const event = await getEventById(eventId);
    if (!event) {
      return NextResponse.json(
        { error: 'Event not found' },
        { status: 404 }
      );
    }

    if (session.user.role === 'organizer' && event.organizerId !== session.user.id) {
      return NextResponse.json({ error: 'Only the event organizer or an admin can manage checkpoints' }, { status: 403 });
    }
    if (!event.checkpoints?.includes(checkpoint)) {
      return NextResponse.json({ error: 'Checkpoint does not exist in this event' }, { status: 400 });
    }
    
    let updatedEvent;
    if (action === 'unlock') {
      updatedEvent = await unlockCheckpoint(eventId, checkpoint);
    } else if (action === 'lock') {
      updatedEvent = await lockCheckpoint(eventId, checkpoint);
    } else {
      return NextResponse.json(
        { error: 'Invalid action. Use "unlock" or "lock"' },
        { status: 400 }
      );
    }
    
    if (!updatedEvent) {
      return NextResponse.json(
        { error: 'Failed to update checkpoint' },
        { status: 500 }
      );
    }
    
    return NextResponse.json({
      success: true,
      event: updatedEvent
    });
    
  } catch (error) {
    console.error('Error managing checkpoint:', error);
    return NextResponse.json(
      { error: (error as Error).message || 'Failed to manage checkpoint' },
      { status: 500 }
    );
  }
}
