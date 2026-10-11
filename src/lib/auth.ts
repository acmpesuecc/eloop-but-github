import NextAuth from "next-auth";
import type { NextAuthOptions } from "next-auth";
import GitHubProvider from "next-auth/providers/github";
import { getUserByEmail, createUser } from "@/lib/db/user";
import { UserRole } from "@/types";
import { getMissingEnvVars } from "@/lib/env";

// Validate environment variables on startup (delegated to shared helper)
const missingEnvVars = getMissingEnvVars();
if (missingEnvVars.length > 0) {
  console.error(`Missing required environment variables: ${missingEnvVars.join(', ')}`);
}

// Define the shape of the session user object
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      name: string;
      email: string;
      role: UserRole;
      organizerId?: string;
    };
  }
}

// The JWT token shape is defined in /src/types/next-auth.d.ts

export const authConfig: NextAuthOptions = {
  providers: [
    GitHubProvider({
      clientId: process.env.GITHUB_CLIENT_ID || "",
      clientSecret: process.env.GITHUB_CLIENT_SECRET || "",
    }),
  ],
  // Disable debug to reduce noise
  debug: false,
  callbacks: {
    // The database and admin assignment require a real email address.
    async signIn({ user }) {
      return Boolean(user.email);
    },
    async jwt({ token, user }) {
      // First time sign in
      if (user) {
        try {
          console.log("Fetching user from database:", user.email);
          let dbUser = await getUserByEmail(user.email!);

          // If it's a new user, check if email matches ADMIN_EMAIL in env
          if (!dbUser) {
            const userId = crypto.randomUUID();
            console.log("Creating new user with ID:", userId);

            // Check if this user's email matches the admin email in env
            const adminEmail = process.env.ADMIN_EMAIL;
            const isAdmin = adminEmail && user.email?.toLowerCase() === adminEmail.toLowerCase();
            const role = isAdmin ? 'admin' : 'applicant'; // New users start as applicants
            console.log(`Creating user with role: ${role} (Admin email match: ${isAdmin})`);

            try {
              console.log(`Attempting to create user: ${JSON.stringify({
                id: userId,
                email: user.email!,
                name: user.name!,
                role: role,
              })}`);

              dbUser = await createUser({
                id: userId,
                email: user.email!,
                name: user.name!,
                role: role,
              });

              console.log(`User created successfully: ${JSON.stringify(dbUser)}`);
            } catch (createError) {
              console.error(`Error creating user: ${createError instanceof Error ? createError.message : String(createError)}`);
              throw createError; // Re-throw to be caught by outer catch
            }
          }

          console.log("User found/created:", dbUser);
          return {
            ...token,
            id: dbUser.id,
            role: dbUser.role,
            organizerId: dbUser.organizerId,
          };
        } catch (error) {
          console.error("Error in JWT callback:", error);
          // Return basic token data to prevent complete auth failure
          return {
            ...token,
            id: crypto.randomUUID(),
            role: 'participant'
          };
        }
      }

      // On subsequent calls, return the token
      return token;
    },

    async session({ session, token }) {
      // Add user role and id to the session
      if (token && session.user) {
        session.user.id = token.id as string;
        session.user.role = token.role as UserRole;
        if (token.organizerId) {
          session.user.organizerId = token.organizerId as string;
        }
      }
      return session;
    },
  },
  pages: {
    signIn: '/auth/signin',
    signOut: '/auth/signout',
    error: '/auth/error',
  },
  session: {
    strategy: 'jwt',
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },
  secret: process.env.NEXTAUTH_SECRET,
};


// Role-based authorization utility
export function canAccessRole(userRole: UserRole, requiredRole: UserRole): boolean {
  const roleHierarchy: Record<UserRole, number> = {
    'admin': 4,
    'organizer': 3,
    'mentor': 2.5,
    'volunteer': 2,
    'participant': 1,
    'applicant': 0, // Applicants have lowest access
  };

  return roleHierarchy[userRole] >= roleHierarchy[requiredRole];
}

const nextAuthHandler = NextAuth(authConfig);
export const handlers = { GET: nextAuthHandler, POST: nextAuthHandler };
import { getServerSession } from "next-auth/next";
import type { Session } from "next-auth";

export async function auth(): Promise<Session | null> {
  try {
    // Attempt to resolve a server session using next-auth helper
    // Fallback to null on any error to avoid build-time crashes
    // `getServerSession` accepts the auth options and reads cookies from the environment
    // in Next.js server environment.
    // @ts-ignore - `getServerSession` typing can be awkward in some Next.js/Bun setups
    const session = await getServerSession(authConfig as any);
    return (session as Session) ?? null;
  } catch (error) {
    return null;
  }
}
export async function signOut(_opts?: Record<string, unknown>) {
  // No-op server-side signOut shim. Route clears cookies itself.
  return;
}
