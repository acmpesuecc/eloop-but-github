import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { updateUserRole, getUserById } from '@/lib/db/user';
import { hasOrganizerPrivileges } from '@/lib/db/user';
import { getEventById } from '@/lib/db/event';

// Create volunteer account
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
    
    // Only admin or organizer can create volunteers
    const canCreateVolunteer = await hasOrganizerPrivileges(session.user.id);
    if (!canCreateVolunteer) {
      return NextResponse.json(
        { error: 'Organizer privileges required' },
        { status: 403 }
      );
    }
    
    // Parse request body
    const body = await request.json().catch(() => null);
    const { userId, eventId } = body || {};
    
    if (typeof userId !== 'string' || !userId.trim()) {
      return NextResponse.json(
        { error: 'User ID is required' },
        { status: 400 }
      );
    }

    let organizerId = session.user.role === 'admin' ? undefined : session.user.id;
    if (eventId !== undefined) {
      if (typeof eventId !== 'string' || !eventId.trim()) {
        return NextResponse.json({ error: 'Invalid event ID' }, { status: 400 });
      }
      const event = await getEventById(eventId);
      if (!event) {
        return NextResponse.json({ error: 'Event not found' }, { status: 404 });
      }
      if (session.user.role !== 'admin' && event.organizerId !== session.user.id) {
        return NextResponse.json({ error: 'Only the event organizer or an admin can add volunteers' }, { status: 403 });
      }
      organizerId = event.organizerId;
    }

    const existingUser = await getUserById(userId);
    if (!existingUser) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }
    if (!['applicant', 'participant', 'volunteer'].includes(existingUser.role)) {
      return NextResponse.json({ error: 'Cannot change admin, organizer, or mentor roles through volunteer creation' }, { status: 400 });
    }
    if (userId === session.user.id) {
      return NextResponse.json({ error: 'Cannot change your own role' }, { status: 400 });
    }
    
    // Update user role to volunteer
    // Assign volunteer to this organizer
    const volunteerUser = await updateUserRole(userId, 'volunteer', organizerId);
    
    if (!volunteerUser) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }
    
    return NextResponse.json({
      success: true,
      user: {
        id: volunteerUser.id,
        name: volunteerUser.name,
        email: volunteerUser.email,
        role: volunteerUser.role,
        organizerId: volunteerUser.organizerId
      }
    });
  } catch (error) {
    console.error('Create volunteer error:', error);
    return NextResponse.json(
      { error: 'Failed to create volunteer' },
      { status: 500 }
    );
  }
}
