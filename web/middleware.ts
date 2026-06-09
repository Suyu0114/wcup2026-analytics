import createMiddleware from 'next-intl/middleware';
import { routing } from './lib/routing';

// Locale routing: / → /zh-TW (default), Accept-Language negotiation (spec §3.1 / Issue 9).
export default createMiddleware(routing);

export const config = {
  // Skip API, Next internals, and static files.
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
};
