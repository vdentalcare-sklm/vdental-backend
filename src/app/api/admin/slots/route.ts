// app/api/admin/slots/route.ts
import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';

function isAuthorized(request: Request): boolean {
  return request.headers.get('authorization') === `Bearer ${process.env.ADMIN_SECRET}`;
}

// ── GET /api/admin/slots?date=YYYY-MM-DD — slots for a specific date ──────────
export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const date = searchParams.get('date');

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json(
        { error: 'Provide a date in YYYY-MM-DD format.' },
        { status: 400 }
      );
    }

    const slots = await sql`
      SELECT
        t.id,
        to_char(t.time, 'HH12:MI AM') AS time,
        t.is_booked,
        p.name  AS booked_by_name,
        p.phone AS booked_by_phone
      FROM      TimeSlots    t
      LEFT JOIN Appointments a ON a.slot_id    = t.id AND a.status != 'Cancelled'
      LEFT JOIN Patients     p ON a.patient_id = p.id
      WHERE t.date = ${date}::date
      ORDER BY t.time ASC
    `;

    return NextResponse.json({ success: true, date, slots });

  } catch (error) {
    console.error('Fetch slots error:', error);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}

// ── POST /api/admin/slots — add a new slot ────────────────────────────────────
export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  try {
    const { date, time } = await request.json();

    if (!date || !time) {
      return NextResponse.json(
        { error: 'date and time are required.' },
        { status: 400 }
      );
    }

    // Validate date is not in the past
    const slotDate = new Date(date);
    const today    = new Date();
    today.setHours(0, 0, 0, 0);
    if (slotDate < today) {
      return NextResponse.json(
        { error: 'Cannot add slots for past dates.' },
        { status: 400 }
      );
    }

    const result = await sql`
      INSERT INTO TimeSlots (date, time)
      VALUES (${date}::date, ${time}::time)
      ON CONFLICT (date, time) DO NOTHING
      RETURNING id, date, to_char(time, 'HH12:MI AM') AS time
    `;

    if (result.length === 0) {
      return NextResponse.json(
        { error: 'A slot at this time already exists for this date.' },
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
export async function DELETE(request: Request) {
  if (!isAuthorized(request)) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  try {
    const { id } = await request.json();

    if (!id) {
      return NextResponse.json({ error: 'slot id is required.' }, { status: 400 });
    }

    // Refuse to delete a booked slot
    const slot = await sql`SELECT is_booked FROM TimeSlots WHERE id = ${id}`;

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