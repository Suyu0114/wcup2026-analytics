import { NextResponse } from 'next/server';
import { getGroups } from '@/lib/data';

export const dynamic = 'force-dynamic';

export async function GET() {
  const data = await getGroups();
  return NextResponse.json(data, {
    status: data.unavailable ? 503 : 200,
  });
}
