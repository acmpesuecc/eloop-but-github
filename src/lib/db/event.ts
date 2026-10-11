import { turso } from './client';
import { Event, FormSchema } from '@/types';

// Helper to convert database row to Event object
function rowToEvent(row: Record<string, unknown>): Event {
  return {
    id: row.id as string,
    name: row.name as string,
    description: row.description as string,
    date: new Date(row.date as number),
    startDate: row.start_date ? new Date(row.start_date as string) : undefined,
    endDate: row.end_date ? new Date(row.end_date as string) : undefined,
    registrationCloseDate: row.registration_close_date ? new Date(row.registration_close_date as string) : undefined,
    location: row.location as string,
    imageUrl: row.image_url ? (row.image_url as string) : undefined,
    organizerId: row.organizer_id as string,
    checkpoints: row.checkpoints ? JSON.parse(row.checkpoints as string) : ["Checkin"],
    unlockedCheckpoints: row.unlocked_checkpoints ? JSON.parse(row.unlocked_checkpoints as string) : ["Checkin"],
    isRegistrationOpen: row.is_registration_open !== undefined ? Boolean(row.is_registration_open) : true,
    isTeamFormationOpen: row.is_team_formation_open !== undefined ? Boolean(row.is_team_formation_open) : false,
    formSchema: JSON.parse(row.form_schema as string) as FormSchema,
    createdAt: new Date(row.created_at as number),
    updatedAt: new Date(row.updated_at as number)
  };
}

// Create a new event
export async function createEvent(event: Omit<Event, 'id' | 'createdAt' | 'updatedAt'>): Promise<Event> {
  try {
    console.log('Creating event:', {
      name: event.name,
      description: event.description?.substring(0, 30) + '...',
      date: event.date,
      startDate: event.startDate,
      endDate: event.endDate,
      registrationCloseDate: event.registrationCloseDate,
      location: event.location,
      organizerId: event.organizerId,
      checkpoints: event.checkpoints,
      formSchema: JSON.stringify(event.formSchema).substring(0, 100) + '...'
    });

    const now = Date.now();
    const id = crypto.randomUUID();

    // Make sure formSchema has an eventId
    const formSchema = {
      ...event.formSchema,
      eventId: id
    };

    await turso.execute({
      sql: `
        INSERT INTO events (id, name, description, date, start_date, end_date, registration_close_date, location, image_url, organizer_id, checkpoints, unlocked_checkpoints, is_registration_open, form_schema, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      args: [
        id,
        event.name,
        event.description,
        event.date.getTime(),
        event.startDate?.toISOString() || event.date.toISOString(),
        event.endDate?.toISOString() || null,
        event.registrationCloseDate?.toISOString() || null,
        event.location,
        event.imageUrl || null,
        event.organizerId,
        JSON.stringify(event.checkpoints || ["Checkin"]),
        JSON.stringify(["Checkin"]), // Default: only Checkin is unlocked
        1, // is_registration_open defaults to TRUE
        JSON.stringify(formSchema),
        now,
        now
      ]
    });

    console.log('Event created successfully with ID:', id);

    return {
      ...event,
      id,
      formSchema,
      unlockedCheckpoints: ["Checkin"], // Default: only Checkin is unlocked
      createdAt: new Date(now),
      updatedAt: new Date(now)
    };
  } catch (error) {
    console.error('Database error creating event:', error);
    console.error('Error details:', {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      name: error instanceof Error ? error.name : undefined
    });
    throw new Error(`Database error: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

// Get an event by id
export async function getEventById(id: string): Promise<Event | null> {
  const result = await turso.execute({
    sql: `SELECT * FROM events WHERE id = ?`,
    args: [id]
  });

  if (result.rows.length === 0) {
    return null;
  }

  return rowToEvent(result.rows[0]);
}

// Get all events for an organizer
export async function getOrganizerEvents(organizerId: string): Promise<Event[]> {
  const result = await turso.execute({
    sql: `SELECT * FROM events WHERE organizer_id = ? ORDER BY date DESC`,
    args: [organizerId]
  });

  return result.rows.map(rowToEvent);
}

// Get all events (for admin)
export async function getAllEvents(): Promise<Event[]> {
  const result = await turso.execute({
    sql: `SELECT * FROM events ORDER BY date DESC`
  });

  return result.rows.map(rowToEvent);
}

// Update event form schema
export async function updateEventFormSchema(eventId: string, formSchema: FormSchema): Promise<Event | null> {
  const now = Date.now();
  await turso.execute({
    sql: `
      UPDATE events 
      SET form_schema = ?, updated_at = ?
      WHERE id = ?
    `,
    args: [JSON.stringify(formSchema), now, eventId]
  });

  return getEventById(eventId);
}

// Update event details
export async function updateEvent(eventId: string, eventData: Partial<Omit<Event, 'id' | 'createdAt' | 'updatedAt'>>): Promise<Event | null> {
  const event = await getEventById(eventId);
  if (!event) return null;

  const updates: string[] = [];
  const args: (string | number)[] = [];

  if (eventData.name) {
    updates.push('name = ?');
    args.push(eventData.name);
  }

  if (eventData.description) {
    updates.push('description = ?');
    args.push(eventData.description);
  }

  if (eventData.date) {
    updates.push('date = ?');
    args.push(eventData.date.getTime());
  }

  if (eventData.location) {
    updates.push('location = ?');
    args.push(eventData.location);
  }

  if (eventData.formSchema) {
    updates.push('form_schema = ?');
    args.push(JSON.stringify(eventData.formSchema));
  }

  if (updates.length === 0) {
    return event;
  }

  const now = Date.now();
  updates.push('updated_at = ?');
  args.push(now);

  args.push(eventId);

  await turso.execute({
    sql: `
      UPDATE events 
      SET ${updates.join(', ')}
      WHERE id = ?
    `,
    args
  });

  return getEventById(eventId);
}

// Delete an event
export async function deleteEvent(eventId: string): Promise<boolean> {
  // First delete all registrations for this event
  await turso.execute({
    sql: `DELETE FROM registrations WHERE event_id = ?`,
    args: [eventId]
  });

  // Then delete the event
  const result = await turso.execute({
    sql: `DELETE FROM events WHERE id = ?`,
    args: [eventId]
  });

  return result.rowsAffected > 0;
}

// Unlock a checkpoint for an event (organizer control)
export async function unlockCheckpoint(eventId: string, checkpoint: string): Promise<Event | null> {
  const event = await getEventById(eventId);
  if (!event) return null;

  // Check if checkpoint exists in event's checkpoint list
  if (!event.checkpoints?.includes(checkpoint)) {
    throw new Error('Checkpoint does not exist in this event');
  }

  // Check if already unlocked
  // Already unlocked
  // Repeated starts are idempotent and still normalize the active checkpoint list.

  // Add to unlocked list
  // The update uses the current database value, not a stale client-side list.
  await turso.execute({
    sql: `UPDATE events
          SET unlocked_checkpoints = (
            SELECT json_group_array(value) FROM (
              SELECT value FROM json_each(COALESCE(events.unlocked_checkpoints, '[]'))
              WHERE (? = 'Checkin' OR value = 'Checkin') AND value != ?
              UNION SELECT ? AS value
            )
          ), updated_at = ? WHERE id = ?`,
    args: [checkpoint, checkpoint, checkpoint, Date.now(), eventId]
  });

  return getEventById(eventId);
}

// Lock a checkpoint for an event (organizer control)
export async function lockCheckpoint(eventId: string, checkpoint: string): Promise<Event | null> {
  const event = await getEventById(eventId);
  if (!event) return null;

  if (!event.checkpoints?.includes(checkpoint)) {
    throw new Error('Checkpoint does not exist in this event');
  }

  // Remove from unlocked list
  await turso.execute({
    sql: `UPDATE events
          SET unlocked_checkpoints = (
            SELECT json_group_array(value)
            FROM json_each(COALESCE(events.unlocked_checkpoints, '[]')) WHERE value != ?
          ), updated_at = ? WHERE id = ?`,
    args: [checkpoint, Date.now(), eventId]
  });

  return getEventById(eventId);
}
