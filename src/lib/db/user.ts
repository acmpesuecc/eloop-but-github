import { turso } from './client';
import { UserProfile, UserRole } from '@/types';

// Helper to convert database row to UserProfile object
function rowToUserProfile(row: Record<string, unknown>): UserProfile {
  return {
    id: row.id as string,
    email: row.email as string,
    name: row.name as string,
    role: row.role as UserRole,
    organizerId: row.organizer_id as string | undefined,
    createdAt: new Date(row.created_at as number),
    updatedAt: new Date(row.updated_at as number)
  };
}

// Create a new user
export async function createUser(user: Omit<UserProfile, 'createdAt' | 'updatedAt'>): Promise<UserProfile> {
  console.log(`createUser function called with: ${JSON.stringify(user)}`);
  const now = Date.now();

  try {
    const result = await turso.execute({
      sql: `
        INSERT INTO users (id, email, name, role, organizer_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      args: [
        user.id,
        user.email,
        user.name,
        user.role,
        user.organizerId || null,
        now,
        now
      ]
    });

    console.log(`User inserted into database. Result: ${JSON.stringify(result)}`);

    // Verify the user was created by fetching it back
    const verifyUser = await getUserById(user.id);
    console.log(`User verification: ${verifyUser ? 'Success' : 'Failed'}`);

    return {
      ...user,
      createdAt: new Date(now),
      updatedAt: new Date(now)
    };
  } catch (error) {
    console.error(`Error in createUser: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

// Get a user by id
export async function getUserById(id: string): Promise<UserProfile | null> {
  const result = await turso.execute({
    sql: `SELECT * FROM users WHERE id = ?`,
    args: [id]
  });

  if (result.rows.length === 0) {
    return null;
  }

  return rowToUserProfile(result.rows[0]);
}

// Get a user by email
export async function getUserByEmail(email: string): Promise<UserProfile | null> {
  const result = await turso.execute({
    sql: `SELECT * FROM users WHERE email = ?`,
    args: [email]
  });

  if (result.rows.length === 0) {
    return null;
  }

  return rowToUserProfile(result.rows[0]);
}

// Promote applicant to participant (approval)
export async function approveApplicant(userId: string): Promise<UserProfile | null> {
  const now = Date.now();
  await turso.execute({
    sql: `
      UPDATE users 
      SET role = 'participant', updated_at = ?
      WHERE id = ? AND role = 'applicant'
    `,
    args: [now, userId]
  });

  return getUserById(userId);
}

// Assign volunteer to organizer
export async function assignVolunteerToOrganizer(volunteerId: string, organizerId: string): Promise<UserProfile | null> {
  const now = Date.now();
  await turso.execute({
    sql: `
      UPDATE users 
      SET organizer_id = ?, updated_at = ?
      WHERE id = ? AND role = 'volunteer'
    `,
    args: [organizerId, now, volunteerId]
  });

  return getUserById(volunteerId);
}

// Get all volunteers for an organizer
export async function getOrganizerVolunteers(organizerId: string): Promise<UserProfile[]> {
  const result = await turso.execute({
    sql: `SELECT * FROM users WHERE organizer_id = ? AND role = 'volunteer'`,
    args: [organizerId]
  });

  return result.rows.map(rowToUserProfile);
}

// Check if user has admin privileges
export async function isUserAdmin(userId: string): Promise<boolean> {
  const user = await getUserById(userId);
  return user?.role === 'admin';
}

// Check if user has organizer privileges (includes admin)
export async function hasOrganizerPrivileges(userId: string): Promise<boolean> {
  const user = await getUserById(userId);
  return user?.role === 'admin' || user?.role === 'organizer';
}

// Check if user has volunteer privileges (includes admin and organizer)
export async function hasVolunteerPrivileges(userId: string): Promise<boolean> {
  const user = await getUserById(userId);
  return user?.role === 'admin' || user?.role === 'organizer' || user?.role === 'volunteer';
}

// Get all users (admin only)
export async function getAllUsers(): Promise<UserProfile[]> {
  const result = await turso.execute({
    sql: `SELECT * FROM users ORDER BY role, name`
  });

  return result.rows.map(rowToUserProfile);
}

// Get users by role
export async function getUsersByRole(role: UserRole): Promise<UserProfile[]> {
  const result = await turso.execute({
    sql: `SELECT * FROM users WHERE role = ? ORDER BY name`,
    args: [role]
  });

  return result.rows.map(rowToUserProfile);
}

// Get all applicants (unapproved users)
export async function getApplicants(): Promise<UserProfile[]> {
  const result = await turso.execute({
    sql: `SELECT * FROM users WHERE role = 'applicant' ORDER BY created_at DESC`
  });

  return result.rows.map(rowToUserProfile);
}

// Get applicants who have never created a registration
export async function getApplicantsWithoutRegistrations(): Promise<UserProfile[]> {
  const result = await turso.execute({
    sql: `
      SELECT u.* FROM users u
      LEFT JOIN registrations r ON u.id = r.user_id
      WHERE u.role = 'applicant'
      GROUP BY u.id
      HAVING COUNT(r.id) = 0
      ORDER BY u.created_at DESC
    `
  });

  return result.rows.map(rowToUserProfile);
}

export async function getApplicantsWithoutRegistrationsForEvent(eventId: string): Promise<UserProfile[]> {
  const result = await turso.execute({
    sql: `
      SELECT u.* FROM users u
      WHERE u.role = 'applicant' AND NOT EXISTS (
        SELECT 1 FROM registrations r WHERE r.user_id = u.id AND r.event_id = ?
      )
      ORDER BY u.created_at DESC
    `,
    args: [eventId]
  });

  return result.rows.map(rowToUserProfile);
}

// Update a user's role
export async function updateUserRole(userId: string, newRole: UserRole, organizerId?: string): Promise<UserProfile | null> {
  const now = Date.now();
  // Volunteer promotion and optional organizer assignment share one atomic update.
  // Other role changes and calls without an organizer preserve the existing association.
  const assignOrganizer = newRole === 'volunteer' && organizerId !== undefined;
  await turso.execute({
    sql: `
      UPDATE users 
      SET role = ?, ${assignOrganizer ? 'organizer_id = ?, ' : ''}updated_at = ?
      WHERE id = ?
    `,
    args: assignOrganizer ? [newRole, organizerId, now, userId] : [newRole, now, userId]
  });

  return getUserById(userId);
}

// Count the total number of users in the system
export async function countUsers(): Promise<number> {
  const result = await turso.execute({
    sql: `SELECT COUNT(*) as count FROM users`
  });

  return Number(result.rows[0]?.count || 0);
}

// Delete a user by id. Returns true if a row was deleted.
export async function deleteUser(userId: string): Promise<boolean> {
  // Prevent deleting users who own non-nullable resources (events or teams)
  try {
    const eventsOwned = await turso.execute({ sql: `SELECT COUNT(*) as count FROM events WHERE organizer_id = ?`, args: [userId] });
    const eventsCount = Number(eventsOwned.rows[0]?.count || 0);
    if (eventsCount > 0) {
      throw new Error('User owns events. Reassign or delete those events before deleting the user.');
    }

    const teamsOwned = await turso.execute({ sql: `SELECT COUNT(*) as count FROM teams WHERE created_by = ?`, args: [userId] });
    const teamsCount = Number(teamsOwned.rows[0]?.count || 0);
    if (teamsCount > 0) {
      throw new Error('User created teams. Reassign or delete those teams before deleting the user.');
    }
  } catch (e) {
    // If we threw a helpful error above, rethrow so callers can surface it
    if (e instanceof Error) {
      console.error('Pre-delete checks failed:', e.message);
      throw e;
    }
  }

  // Nullify references in registrations where this user acted as approver/rejector
  try {
    await turso.execute({
      sql: `UPDATE registrations SET approved_by = NULL WHERE approved_by = ?`,
      args: [userId],
    });
    await turso.execute({
      sql: `UPDATE registrations SET rejected_by = NULL WHERE rejected_by = ?`,
      args: [userId],
    });
  } catch (e) {
    console.error('Failed to nullify registration approver/rejector references:', e);
  }

  // Nullify references in team_scores where this user graded teams
  try {
    await turso.execute({
      sql: `UPDATE team_scores SET graded_by = NULL WHERE graded_by = ?`,
      args: [userId],
    });
  } catch (e) {
    console.error('Failed to nullify team_scores graded_by references:', e);
  }

  // Remove user from any teams.member_ids arrays
  try {
    const teamsWithMember = await turso.execute({
      sql: `SELECT id, member_ids FROM teams WHERE member_ids LIKE ?`,
      args: [`%${userId}%`],
    });

    for (const row of teamsWithMember.rows) {
      try {
        const id = row.id as string;
        const memberIdsRaw = row.member_ids as string;
        let members: string[] = [];
        try {
          members = JSON.parse(memberIdsRaw);
        } catch (parseErr) {
          console.warn(`Failed to parse member_ids for team ${id}:`, parseErr);
          continue;
        }

        const newMembers = members.filter(m => m !== userId);
        if (newMembers.length !== members.length) {
          await turso.execute({
            sql: `UPDATE teams SET member_ids = ? WHERE id = ?`,
            args: [JSON.stringify(newMembers), id],
          });
        }
      } catch (innerE) {
        console.error('Failed to update team membership while deleting user:', innerE);
      }
    }
  } catch (e) {
    console.error('Failed to find teams containing user as member:', e);
  }

  // Delete registrations that belong to this user
  try {
    await turso.execute({
      sql: `DELETE FROM registrations WHERE user_id = ?`,
      args: [userId],
    });
  } catch (e) {
    console.error('Failed to delete registrations for user:', e);
    // continue to attempt deleting the user record anyway
  }

  // Finally, delete the user row
  const result = await turso.execute({
    sql: `DELETE FROM users WHERE id = ?`,
    args: [userId]
  });

  // `result` shape may vary; check rowsAffected or similar if available
  try {
    // @ts-ignore
    if (typeof result.rowsAffected === 'number') {
      // rowsAffected available
      return result.rowsAffected > 0;
    }
  } catch (e) {
    // ignore
  }

  // Fallback: attempt to query the user
  const existing = await getUserById(userId);
  return existing === null;
}
