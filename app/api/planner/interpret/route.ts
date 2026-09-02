import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST() {
  const response = NextResponse.json(
    { error: 'This Assistant endpoint has moved.' },
    { status: 410 },
  );
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
