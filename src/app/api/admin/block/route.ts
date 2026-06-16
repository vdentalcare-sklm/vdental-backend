import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';

function isAuthorized(request: Request): boolean {
  return request.headers.get('authorization') === `Bearer ${process.env.ADMIN_SECRET}`;
}

// ── GET /api/admin/block?branchId=1&date=YYYY-MM-DD ──────────────────────────
// Without date: returns all blocked dates for a branch
// With date: returns blocked slots for that specific date at that branch
export async function GET(request: Request) {
  if (!isAuthorized(request)) return new NextResponse('Unauthorized', { status: 401 });

  const { searchParams } = new URL(request.url);
  const branchId = searchParams.get('branchId');
  const date     = searchParams.get('date');

  if (!branchId) {
    return NextResponse.json({ error: 'branchId is required.' }, { status: 400 });
  }

  try {
    if (date) {
      const slots = await sql`
        SELECT id, to_char(time, 'HH12:MI AM') AS time, reason
        FROM   BlockedSlots
        WHERE  branch_id = ${branchId}
          AND  date      = ${date}::date
        ORDER  BY time ASC
      `;

      const dateBlocked = await sql`
        SELECT id, reason
        FROM   BlockedDates
        WHERE  branch_id = ${branchId}
          AND  date      = ${date}::date
        LIMIT  1
      `;

      return NextResponse.json({
        branch_id:    Number(branchId),
        date,
        date_blocked: dateBlocked[0] ?? null,
        blocked_slots: slots,
      });
    } else {
      const dates = await sql`
        SELECT id, to_char(date, 'YYYY-MM-DD') AS date, reason
        FROM   BlockedDates
        WHERE  branch_id = ${branchId}
        ORDER  BY date ASC
      `;

      return NextResponse.json({
        branch_id:     Number(branchId),
        blocked_dates: dates,
      });
    }
  } catch (error) {
    console.error('Block GET error:', error);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}

// ── POST /api/admin/block ─────────────────────────────────────────────────────
// Body: { type: "date", branchId: number, date: "YYYY-MM-DD", reason?: string }
//    or { type: "slot", branchId: number, date: "YYYY-MM-DD", time: "HH:MM", reason?: string }
export async function POST(request: Request) {
  if (!isAuthorized(request)) return new NextResponse('Unauthorized', { status: 401 });

  try {
    const { type, branchId, date, time, reason } = await request.json();

    if (!type || !branchId || !date) {
      return NextResponse.json(
        { error: 'type, branchId, and date are required.' },
        { status: 400 }
      );
    }

    // Verify branch exists
    const branch = await sql`
      SELECT id FROM Branches WHERE id = ${branchId} AND is_active = TRUE LIMIT 1
    `;
    if (branch.length === 0) {
      return NextResponse.json({ error: 'Branch not found.' }, { status: 404 });
    }

    if (type === 'date') {
      const result = await sql`
        INSERT INTO BlockedDates (branch_id, date, reason)
        VALUES (${branchId}, ${date}::date, ${reason ?? null})
        ON CONFLICT (branch_id, date) DO NOTHING
        RETURNING id, to_char(date, 'YYYY-MM-DD') AS date, reason
      `;

      if (result.length === 0) {
        return NextResponse.json(
          { error: 'This date is already blocked for this branch.' },
          { status: 409 }
        );
      }

      return NextResponse.json({ success: true, blocked: result[0] });

    } else if (type === 'slot') {
      if (!time) {
        return NextResponse.json(
          { error: 'time is required for slot blocking.' },
          { status: 400 }
        );
      }

      const result = await sql`
        INSERT INTO BlockedSlots (branch_id, date, time, reason)
        VALUES (${branchId}, ${date}::date, ${time}::time, ${reason ?? null})
        ON CONFLICT (branch_id, date, time) DO NOTHING
        RETURNING id, to_char(time, 'HH12:MI AM') AS time, reason
      `;

      if (result.length === 0) {
        return NextResponse.json(
          { error: 'This slot is already blocked for this branch.' },
          { status: 409 }
        );
      }

      return NextResponse.json({ success: true, blocked: result[0] });

    } else {
      return NextResponse.json(
        { error: 'type must be "date" or "slot".' },
        { status: 400 }
      );
    }
  } catch (error) {
    console.error('Block POST error:', error);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}

// ── DELETE /api/admin/block ───────────────────────────────────────────────────
// Body: { type: "date", id: number }
//    or { type: "slot", id: number }
export async function DELETE(request: Request) {
  if (!isAuthorized(request)) return new NextResponse('Unauthorized', { status: 401 });

  try {
    const { type, id } = await request.json();

    if (!type || !id) {
      return NextResponse.json(
        { error: 'type and id are required.' },
        { status: 400 }
      );
    }

    if (type === 'date') {
      const result = await sql`
        DELETE FROM BlockedDates WHERE id = ${id} RETURNING id
      `;
      if (result.length === 0) {
        return NextResponse.json({ error: 'Not found.' }, { status: 404 });
      }
      return NextResponse.json({ success: true });

    } else if (type === 'slot') {
      const result = await sql`
        DELETE FROM BlockedSlots WHERE id = ${id} RETURNING id
      `;
      if (result.length === 0) {
        return NextResponse.json({ error: 'Not found.' }, { status: 404 });
      }
      return NextResponse.json({ success: true });

    } else {
      return NextResponse.json(
        { error: 'type must be "date" or "slot".' },
        { status: 400 }
      );
    }
  } catch (error) {
    console.error('Block DELETE error:', error);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}