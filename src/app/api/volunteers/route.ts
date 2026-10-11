import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getOrganizerVolunteers, getAllUsers } from '@/lib/db/user';
import { getEventById } from '@/lib/db/event';

/**
 * GET /api/volunteers
 * Get volunteers (organizer sees their volunteers, admin sees all)
 */
export async function GET(request: Request) {
  try {
    const session = await auth();
    
    if (!session?.user) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const role = session.user.role;
    
    if (role !== 'admin' && role !== 'organizer') {
      return NextResponse.json(
        { error: 'Unauthorized - organizer access required' },
        { status: 403 }
      );
    }

    let volunteers;
    const eventId = new URL(request.url).searchParams.get('eventId');
    if (eventId) {
      const event = await getEventById(eventId);
      if (!event) {
        return NextResponse.json({ error: 'Event not found' }, { status: 404 });
      }
      if (role === 'organizer' && event.organizerId !== session.user.id) {
        return NextResponse.json({ error: 'Only the event organizer or an admin can view its volunteers' }, { status: 403 });
      }
      // Event staffing uses the existing organizer association, not a separate roster.
      volunteers = await getOrganizerVolunteers(event.organizerId);
      return NextResponse.json({ volunteers });
    }
    
    if (role === 'admin') {
      const allUsers = await getAllUsers();
      volunteers = allUsers.filter(u => u.role === 'volunteer');
    } else {
      volunteers = await getOrganizerVolunteers(session.user.id);
    }
    
    return NextResponse.json({ volunteers });
  } catch (error) {
    console.error('Error fetching volunteers:', error);
    return NextResponse.json(
      { error: 'Failed to fetch volunteers' },
      { status: 500 }
    );
  }
}
