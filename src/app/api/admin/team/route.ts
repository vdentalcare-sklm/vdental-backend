import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { del } from '@vercel/blob';

export const dynamic = 'force-dynamic';

function isAuthorized(request: Request): boolean {
  return request.headers.get('authorization') === `Bearer ${process.env.ADMIN_SECRET}`;
}

// ── GET /api/admin/team ───────────────────────────────────────────────────────
export async function GET(request: Request) {
  if (!isAuthorized(request)) return new NextResponse('Unauthorized', { status: 401 });

  try {
    const members = await sql`
      SELECT id, name, role, image_url, display_order, created_at
      FROM   TeamMembers
      ORDER  BY display_order ASC, created_at ASC
    `;
    return NextResponse.json({ success: true, members });
  } catch (error) {
    console.error('Fetch team error:', error);
    return NextResponse.json({ error: 'Failed to fetch team members.' }, { status: 500 });
  }
}

// ── POST /api/admin/team ──────────────────────────────────────────────────────
// Body: { name, role, image_url, display_order? }
export async function POST(request: Request) {
  if (!isAuthorized(request)) return new NextResponse('Unauthorized', { status: 401 });

  try {
    const { name, role, image_url, display_order } = await request.json();

    if (!name || !role || !image_url) {
      return NextResponse.json(
        { error: 'name, role, and image_url are required.' },
        { status: 400 }
      );
    }

    const result = await sql`
      INSERT INTO TeamMembers (name, role, image_url, display_order)
      VALUES (
        ${name.trim()},
        ${role.trim()},
        ${image_url.trim()},
        ${display_order ?? 0}
      )
      RETURNING *
    `;

    return NextResponse.json({ success: true, member: result[0] });
  } catch (error) {
    console.error('Add team member error:', error);
    return NextResponse.json({ error: 'Failed to add team member.' }, { status: 500 });
  }
}

// ── PATCH /api/admin/team ─────────────────────────────────────────────────────
// Body: { id, name?, role?, image_url?, display_order? }
export async function PATCH(request: Request) {
  if (!isAuthorized(request)) return new NextResponse('Unauthorized', { status: 401 });

  try {
    const { id, name, role, image_url, display_order } = await request.json();

    if (!id) {
      return NextResponse.json({ error: 'id is required.' }, { status: 400 });
    }

    const existing = await sql`
      SELECT id, image_url FROM TeamMembers WHERE id = ${id}
    `;
    if (existing.length === 0) {
      return NextResponse.json({ error: 'Team member not found.' }, { status: 404 });
    }

    // If image is being replaced, delete the old one from Vercel Blob
    if (image_url && image_url !== existing[0].image_url) {
      try {
        await del(existing[0].image_url);
      } catch (err) {
        // Non-fatal — old blob may already be gone
        console.warn('Could not delete old team member image:', err);
      }
    }

    const result = await sql`
      UPDATE TeamMembers
      SET
        name          = COALESCE(${name?.trim()      ?? null}, name),
        role          = COALESCE(${role?.trim()      ?? null}, role),
        image_url     = COALESCE(${image_url?.trim() ?? null}, image_url),
        display_order = COALESCE(${display_order     ?? null}, display_order)
      WHERE id = ${id}
      RETURNING *
    `;

    return NextResponse.json({ success: true, member: result[0] });
  } catch (error) {
    console.error('Update team member error:', error);
    return NextResponse.json({ error: 'Failed to update team member.' }, { status: 500 });
  }
}

// ── DELETE /api/admin/team ────────────────────────────────────────────────────
// Body: { id, image_url }
export async function DELETE(request: Request) {
  if (!isAuthorized(request)) return new NextResponse('Unauthorized', { status: 401 });

  try {
    const { id, image_url } = await request.json();

    if (!id) {
      return NextResponse.json({ error: 'id is required.' }, { status: 400 });
    }

    const existing = await sql`
      SELECT id FROM TeamMembers WHERE id = ${id}
    `;
    if (existing.length === 0) {
      return NextResponse.json({ error: 'Team member not found.' }, { status: 404 });
    }

    await sql`DELETE FROM TeamMembers WHERE id = ${id}`;

    // Delete image from Vercel Blob
    if (image_url) {
      try {
        await del(image_url);
      } catch (err) {
        console.warn('Could not delete team member image from blob:', err);
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Delete team member error:', error);
    return NextResponse.json({ error: 'Failed to delete team member.' }, { status: 500 });
  }
}