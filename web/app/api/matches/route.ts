import { NextResponse } from 'next/server';
import { getMatches } from '@/lib/data';

// Server-only read (service key via lib/supabaseServer). Returns all stored matches
// (every stage since P17), no pagination (spec §4.1 / Issue 7). Dynamic — never
// statically cached.
export const dynamic = 'force-dynamic';

export async function GET() {
  const data = await getMatches();
  return NextResponse.json(data, {
    status: data.unavailable ? 503 : 200,
  });
}
