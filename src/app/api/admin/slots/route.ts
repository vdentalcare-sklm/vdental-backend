import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { seedSlotsIfNeeded } from '@/lib/slots';

function isAuthorized(request: Request): boolean {
  return request.headers.get('authorization') === `Bearer ${process.env.ADMIN_SECRET}`;
}

// ── GET /api/admin/slots?branchId=1&date=YYYY-MM-DD ──────────────────────────
export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const branchId = searchParams.get('branchId');
    const date     = searchParams.get('date');

    if (!branchId) {
      return NextResponse.json(
        { error: 'branchId is required.' },
        { status: 400 }
      );
    }

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json(
        { error: 'Provide a date in YYYY-MM-DD format.' },
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

    await seedSlotsIfNeeded(date, Number(branchId));

    const slots = await sql`
      SELECT
        t.id,
        to_char(t.time, 'HH12:MI AM') AS time,
        t.is_booked,
        p.name  AS booked_by_name,
        p.phone AS booked_by_phone
      FROM      TimeSlots    t
      LEFT JOIN Appointments a ON a.slot_id    = t.id
                               AND a.status   != 'Cancelled'
      LEFT JOIN Patients     p ON a.patient_id = p.id
      WHERE t.branch_id = ${branchId}
        AND t.date      = ${date}::date
      ORDER BY t.time ASC
    `;

    return NextResponse.json({ success: true, branch_id: Number(branchId), date, slots });

  } catch (error) {
    console.error('Fetch slots error:', error);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}

// ── POST /api/admin/slots — add a custom slot ─────────────────────────────────
// Body: { branchId: number, date: "YYYY-MM-DD", time: "HH:MM" }
export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  try {
    const { branchId, date, time } = await request.json();

    if (!branchId || !date || !time) {
      return NextResponse.json(
        { error: 'branchId, date, and time are required.' },
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

    const todayIST = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    if (date < todayIST) {
      return NextResponse.json(
        { error: 'Cannot add slots for past dates.' },
        { status: 400 }
      );
    }

    const result = await sql`
      INSERT INTO TimeSlots (branch_id, date, time)
      VALUES (${branchId}, ${date}::date, ${time}::time)
      ON CONFLICT (branch_id, date, time) DO NOTHING
      RETURNING id, branch_id, date, to_char(time, 'HH12:MI AM') AS time
    `;

    if (result.length === 0) {
      return NextResponse.json(
        { error: 'A slot at this time already exists for this branch and date.' },
        { status: 409 }
      );
    }

    return NextResponse.json({ success: true, slot: result[0] });

  } catch (error) {
    console.error('Add slot error:', error);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}

// ── DELETE /api/admin/slots — remove an unbooked slot ────────────────────────
// Body: { id: number }
export async function DELETE(request: Request) {
  if (!isAuthorized(request)) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  try {
    const { id } = await request.json();

    if (!id) {
      return NextResponse.json({ error: 'slot id is required.' }, { status: 400 });
    }

    const slot = await sql`
      SELECT is_booked FROM TimeSlots WHERE id = ${id}
    `;

    if (slot.length === 0) {
      return NextResponse.json({ error: 'Slot not found.' }, { status: 404 });
    }

    if (slot[0].is_booked) {
      return NextResponse.json(
        { error: 'Cannot delete a booked slot. Cancel the appointment first.' },
        { status: 409 }
      );
    }

    await sql`DELETE FROM TimeSlots WHERE id = ${id}`;

    return NextResponse.json({ success: true });

  } catch (error) {
    console.error('Delete slot error:', error);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}