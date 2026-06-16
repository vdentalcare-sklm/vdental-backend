import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';

function isAuthorized(request: Request): boolean {
  return request.headers.get('authorization') === `Bearer ${process.env.ADMIN_SECRET}`;
}

// ── GET /api/admin/branches ───────────────────────────────────────────────────
// Returns all branches ordered by display_order
export async function GET(request: Request) {
  if (!isAuthorized(request)) return new NextResponse('Unauthorized', { status: 401 });

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
        is_active,
        display_order,
        created_at
      FROM   Branches
      ORDER  BY display_order ASC, created_at ASC
    `;
    return NextResponse.json({ success: true, branches });
  } catch (error) {
    console.error('Fetch branches error:', error);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}

// ── POST /api/admin/branches ──────────────────────────────────────────────────
// Body: { name, address, phone, hours?, map_src?, is_main?, display_order? }
export async function POST(request: Request) {
  if (!isAuthorized(request)) return new NextResponse('Unauthorized', { status: 401 });

  try {
    const { name, address, phone, hours, map_src, is_main, display_order } =
      await request.json();

    if (!name || !address || !phone) {
      return NextResponse.json(
        { error: 'name, address, and phone are required.' },
        { status: 400 }
      );
    }

    // If this branch is being set as main, demote any existing main branch first
    if (is_main) {
      await sql`UPDATE Branches SET is_main = FALSE WHERE is_main = TRUE`;
    }

    const result = await sql`
      INSERT INTO Branches (name, address, phone, hours, map_src, is_main, display_order)
      VALUES (
        ${name.trim()},
        ${address.trim()},
        ${phone.trim()},
        ${hours?.trim() ?? 'Mon – Sun | 9:00 AM – 9:00 PM'},
        ${map_src?.trim() ?? null},
        ${is_main ?? false},
        ${display_order ?? 0}
      )
      RETURNING *
    `;

    return NextResponse.json({ success: true, branch: result[0] });
  } catch (error) {
    console.error('Create branch error:', error);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}

// ── PATCH /api/admin/branches ─────────────────────────────────────────────────
// Body: { id, name?, address?, phone?, hours?, map_src?, is_main?, is_active?, display_order? }
export async function PATCH(request: Request) {
  if (!isAuthorized(request)) return new NextResponse('Unauthorized', { status: 401 });

  try {
    const {
      id,
      name,
      address,
      phone,
      hours,
      map_src,
      is_main,
      is_active,
      display_order,
    } = await request.json();

    if (!id) {
      return NextResponse.json({ error: 'id is required.' }, { status: 400 });
    }

    // Check branch exists
    const existing = await sql`SELECT id FROM Branches WHERE id = ${id}`;
    if (existing.length === 0) {
      return NextResponse.json({ error: 'Branch not found.' }, { status: 404 });
    }

    // If promoting this branch to main, demote others first
    if (is_main === true) {
      await sql`UPDATE Branches SET is_main = FALSE WHERE is_main = TRUE AND id != ${id}`;
    }

    const result = await sql`
      UPDATE Branches
      SET
        name          = COALESCE(${name?.trim() ?? null},          name),
        address       = COALESCE(${address?.trim() ?? null},       address),
        phone         = COALESCE(${phone?.trim() ?? null},         phone),
        hours         = COALESCE(${hours?.trim() ?? null},         hours),
        map_src       = COALESCE(${map_src?.trim() ?? null},       map_src),
        is_main       = COALESCE(${is_main ?? null},               is_main),
        is_active     = COALESCE(${is_active ?? null},             is_active),
        display_order = COALESCE(${display_order ?? null},         display_order)
      WHERE id = ${id}
      RETURNING *
    `;

    return NextResponse.json({ success: true, branch: result[0] });
  } catch (error) {
    console.error('Update branch error:', error);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}

// ── DELETE /api/admin/branches ────────────────────────────────────────────────
// Soft delete only — sets is_active = FALSE
// Hard delete is blocked if branch has appointments
// Body: { id, force?: boolean }
export async function DELETE(request: Request) {
  if (!isAuthorized(request)) return new NextResponse('Unauthorized', { status: 401 });

  try {
    const { id, force } = await request.json();

    if (!id) {
      return NextResponse.json({ error: 'id is required.' }, { status: 400 });
    }

    // Check branch exists
    const existing = await sql`SELECT id, is_main FROM Branches WHERE id = ${id}`;
    if (existing.length === 0) {
      return NextResponse.json({ error: 'Branch not found.' }, { status: 404 });
    }

    // Prevent deleting the main branch
    if (existing[0].is_main) {
      return NextResponse.json(
        { error: 'Cannot delete the main branch. Assign another branch as main first.' },
        { status: 409 }
      );
    }

    // Check for existing appointments
    const appointmentCount = await sql`
      SELECT COUNT(*)::int AS count
      FROM   Appointments
      WHERE  branch_id = ${id}
        AND  status NOT IN ('Cancelled')
    `;

    const hasAppointments = appointmentCount[0].count > 0;

    if (hasAppointments && !force) {
      // Soft delete — just deactivate
      await sql`UPDATE Branches SET is_active = FALSE WHERE id = ${id}`;
      return NextResponse.json({
        success: true,
        soft_deleted: true,
        message: 'Branch has existing appointments and has been deactivated instead of deleted.',
      });
    }

    // Hard delete — cascades to TimeSlots, BlockedDates, BlockedSlots via ON DELETE CASCADE
    await sql`DELETE FROM Branches WHERE id = ${id}`;
    return NextResponse.json({ success: true, soft_deleted: false });

  } catch (error) {
    console.error('Delete branch error:', error);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}