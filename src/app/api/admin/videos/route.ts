import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';

export const dynamic = 'force-dynamic';

function isAuthorized(request: Request): boolean {
  return request.headers.get('authorization') === `Bearer ${process.env.ADMIN_SECRET}`;
}

// ── GET /api/admin/videos ─────────────────────────────────────────────────────
export async function GET(request: Request) {
  if (!isAuthorized(request)) return new NextResponse('Unauthorized', { status: 401 });

  try {
    const videos = await sql`
      SELECT id, youtube_id, title, duration, is_featured, display_order, created_at
      FROM   Videos
      ORDER  BY display_order ASC, created_at ASC
    `;
    return NextResponse.json({ success: true, videos });
  } catch (error) {
    console.error('Fetch videos error:', error);
    return NextResponse.json({ error: 'Failed to fetch videos.' }, { status: 500 });
  }
}

// ── POST /api/admin/videos ────────────────────────────────────────────────────
// Body: { youtube_id, title, duration?, is_featured?, display_order? }
export async function POST(request: Request) {
  if (!isAuthorized(request)) return new NextResponse('Unauthorized', { status: 401 });

  try {
    const { youtube_id, title, duration, is_featured, display_order } =
      await request.json();

    if (!youtube_id || !title) {
      return NextResponse.json(
        { error: 'youtube_id and title are required.' },
        { status: 400 }
      );
    }

    // Strip full YouTube URLs down to just the ID if admin pastes a full link
    // Handles: https://youtu.be/ABC123, https://www.youtube.com/watch?v=ABC123
    const cleanId = youtube_id
      .replace(/.*youtu\.be\//, '')
      .replace(/.*[?&]v=/, '')
      .split('&')[0]
      .split('?')[0]
      .trim();

    if (!cleanId) {
      return NextResponse.json(
        { error: 'Could not parse a valid YouTube ID from the provided value.' },
        { status: 400 }
      );
    }

    // If this is being set as featured, unfeature the current featured video first
    if (is_featured) {
      await sql`UPDATE Videos SET is_featured = FALSE WHERE is_featured = TRUE`;
    }

    const result = await sql`
      INSERT INTO Videos (youtube_id, title, duration, is_featured, display_order)
      VALUES (
        ${cleanId},
        ${title.trim()},
        ${duration?.trim() ?? null},
        ${is_featured ?? false},
        ${display_order ?? 0}
      )
      RETURNING *
    `;

    return NextResponse.json({ success: true, video: result[0] });
  } catch (error) {
    console.error('Add video error:', error);
    return NextResponse.json({ error: 'Failed to add video.' }, { status: 500 });
  }
}

// ── PATCH /api/admin/videos ───────────────────────────────────────────────────
// Body: { id, youtube_id?, title?, duration?, is_featured?, display_order? }
export async function PATCH(request: Request) {
  if (!isAuthorized(request)) return new NextResponse('Unauthorized', { status: 401 });

  try {
    const { id, youtube_id, title, duration, is_featured, display_order } =
      await request.json();

    if (!id) {
      return NextResponse.json({ error: 'id is required.' }, { status: 400 });
    }

    const existing = await sql`SELECT id FROM Videos WHERE id = ${id}`;
    if (existing.length === 0) {
      return NextResponse.json({ error: 'Video not found.' }, { status: 404 });
    }

    // Clean YouTube ID if provided
    let cleanId: string | null = null;
    if (youtube_id) {
      cleanId = youtube_id
        .replace(/.*youtu\.be\//, '')
        .replace(/.*[?&]v=/, '')
        .split('&')[0]
        .split('?')[0]
        .trim();

      if (!cleanId) {
        return NextResponse.json(
          { error: 'Could not parse a valid YouTube ID from the provided value.' },
          { status: 400 }
        );
      }
    }

    // If promoting to featured, unfeature others first
    if (is_featured === true) {
      await sql`
        UPDATE Videos SET is_featured = FALSE
        WHERE  is_featured = TRUE AND id != ${id}
      `;
    }

    const result = await sql`
      UPDATE Videos
      SET
        youtube_id    = COALESCE(${cleanId          ?? null}, youtube_id),
        title         = COALESCE(${title?.trim()    ?? null}, title),
        duration      = COALESCE(${duration?.trim() ?? null}, duration),
        is_featured   = COALESCE(${is_featured      ?? null}, is_featured),
        display_order = COALESCE(${display_order    ?? null}, display_order)
      WHERE id = ${id}
      RETURNING *
    `;

    return NextResponse.json({ success: true, video: result[0] });
  } catch (error) {
    console.error('Update video error:', error);
    return NextResponse.json({ error: 'Failed to update video.' }, { status: 500 });
  }
}

// ── DELETE /api/admin/videos ──────────────────────────────────────────────────
// Body: { id }
export async function DELETE(request: Request) {
  if (!isAuthorized(request)) return new NextResponse('Unauthorized', { status: 401 });

  try {
    const { id } = await request.json();

    if (!id) {
      return NextResponse.json({ error: 'id is required.' }, { status: 400 });
    }

    const existing = await sql`SELECT id FROM Videos WHERE id = ${id}`;
    if (existing.length === 0) {
      return NextResponse.json({ error: 'Video not found.' }, { status: 404 });
    }

    await sql`DELETE FROM Videos WHERE id = ${id}`;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Delete video error:', error);
    return NextResponse.json({ error: 'Failed to delete video.' }, { status: 500 });
  }
}