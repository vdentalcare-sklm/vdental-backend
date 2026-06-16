import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const featured = await sql`
      SELECT
        id,
        youtube_id,
        title,
        duration,
        is_featured,
        display_order
      FROM   Videos
      WHERE  is_featured = TRUE
      LIMIT  1
    `;

    const rest = await sql`
      SELECT
        id,
        youtube_id,
        title,
        duration,
        is_featured,
        display_order
      FROM   Videos
      WHERE  is_featured = FALSE
      ORDER  BY display_order ASC, created_at ASC
    `;

    return NextResponse.json({
      success:       true,
      featured:      featured[0] ?? null,
      videos:        rest,
    });
  } catch (error) {
    console.error('Fetch public videos error:', error);
    return NextResponse.json({ error: 'Failed to fetch videos.' }, { status: 500 });
  }
}