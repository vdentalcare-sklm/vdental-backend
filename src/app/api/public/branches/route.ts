import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const branches = await sql`
      SELECT
        id,
        name,
        address,
        phone,
        hours,
        map_src,
        is_main,
        display_order
      FROM   Branches
      WHERE  is_active = TRUE
      ORDER  BY display_order ASC, created_at ASC
    `;
    return NextResponse.json({ success: true, branches });
  } catch (error) {
    console.error('Fetch public branches error:', error);
    return NextResponse.json({ error: 'Failed to fetch branches.' }, { status: 500 });
  }
}