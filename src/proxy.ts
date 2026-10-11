import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { auth } from '@/lib/auth';

export async function proxy(request: NextRequest) {
  const session = await auth();
  const url = request.nextUrl.clone();
  const path = url.pathname;
  const isAuthPath = path.startsWith('/auth');
  const isSignoutPath = path === '/auth/signout';

  // If not authenticated and trying to access protected routes, redirect to login
  if (!session?.user) {
    if (path.startsWith('/dashboard')) {
      url.pathname = '/auth/signin';
      // Always return to the main dashboard after sign-in instead of the specific events path
      url.searchParams.set('callbackUrl', '/dashboard');
      return NextResponse.redirect(url);
    }

    // Allow public access to events pages and registration
    if (path.startsWith('/dashboard/events') || path.startsWith('/register/')) {
      return NextResponse.next();
    }
  } else {
    const userRole = session.user.role || 'applicant';

    if (userRole === 'applicant') {
      const allowedPaths = ['/dashboard', '/dashboard/events'];
      const isAllowedPath = allowedPaths.some(p => path === p || (p === '/dashboard/events' && path.startsWith(p))) || path.startsWith('/register/');
      if (!isAllowedPath) {
        url.pathname = '/dashboard';
        return NextResponse.redirect(url);
      }
    }

    if (path.startsWith('/dashboard/users') && userRole !== 'admin' && userRole !== 'organizer') {
      url.pathname = '/dashboard';
      return NextResponse.redirect(url);
    }

    if (path.startsWith('/dashboard/events/create') && userRole !== 'organizer' && userRole !== 'admin') {
      url.pathname = '/dashboard';
      return NextResponse.redirect(url);
    }

    if (path.startsWith('/dashboard/check-in') && userRole !== 'organizer' && userRole !== 'volunteer') {
      url.pathname = '/dashboard';
      return NextResponse.redirect(url);
    }

    if (isAuthPath && !isSignoutPath) {
      url.pathname = '/dashboard';
      return NextResponse.redirect(url);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/auth/:path*', '/dashboard/:path*', '/register/:path*'],
};
