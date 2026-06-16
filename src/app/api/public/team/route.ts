import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const members = await sql`
      SELECT
        id,
        name,
        role,
        image_url,
        display_order
      FROM   TeamMembers
      ORDER  BY display_order ASC, created_at ASC
    `;
    return NextResponse.json({ success: true, members });
  } catch (error) {
    console.error('Fetch public team error:', error);
    return NextResponse.json({ error: 'Failed to fetch team members.' }, { status: 500 });
  }
}