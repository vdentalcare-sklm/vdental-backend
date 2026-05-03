// middleware.ts
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(req: NextRequest) {
  // Only protect the /admin routes
  if (req.nextUrl.pathname.startsWith('/admin')) {
    const basicAuth = req.headers.get('authorization');
    
    // We use the ADMIN_SECRET from your .env file as the password
    // The username can be anything (e.g., 'admin')
    if (basicAuth) {
      const authValue = basicAuth.split(' ')[1];
      const [user, pwd] = atob(authValue).split(':');

      if (pwd === process.env.ADMIN_SECRET) {
        return NextResponse.next();
      }
    }

    // If no auth or wrong auth, prompt the browser's built-in login box
    return new NextResponse('Auth Required', {
      status: 401,
      headers: {
        'WWW-Authenticate': 'Basic realm="Secure Admin Panel"',
      },
    });
  }

  return NextResponse.next();
}

// Config ensures the middleware ONLY runs on /admin paths to save performance
export const config = {
  matcher: ['/admin/:path*'],
};