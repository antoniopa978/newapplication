import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  // If the path ends with `.php`, rewrite to `/api/secureproxy`
  if (pathname.endsWith('.php')) {
    const url = request.nextUrl.clone();
    url.pathname = '/api/secureproxy';
    url.search = search; // keep query params
    return NextResponse.rewrite(url);
  }

  return NextResponse.next();
}

// Only run middleware on requests ending with .php
export const config = {
  matcher: '/:path*.php',
};
