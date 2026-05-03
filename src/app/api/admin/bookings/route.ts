// app/api/admin/bookings/route.ts
import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';

function isAuthorized(request: Request): boolean {
  return request.headers.get('authorization') === `Bearer ${process.env.ADMIN_SECRET}`;
}

// ── GET /api/admin/bookings — list all bookings with optional status filter ────
export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status'); // optional e.g. ?status=Pending

    const bookings = await sql`
      SELECT
        a.id          AS appointment_id,
        a.reason,
        a.status,
        a.created_at,
        p.id          AS patient_id,
        p.name        AS patient_name,
        p.phone       AS patient_phone,
        p.email       AS patient_email,
        t.id          AS slot_id,
        t.date        AS slot_date,
        to_char(t.time, 'HH12:MI AM') AS slot_time
      FROM      Appointments a
      JOIN      Patients     p ON a.patient_id = p.id
      LEFT JOIN TimeSlots    t ON a.slot_id    = t.id
      WHERE (${status ?? null}::text IS NULL OR a.status = ${status ?? null}::text)
      ORDER BY  a.created_at DESC
    `;

    return NextResponse.json({ success: true, bookings });
  } catch (error) {
    console.error('Fetch bookings error:', error);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}

// ── PATCH /api/admin/bookings — update appointment status ─────────────────────
export async function PATCH(request: Request) {
  if (!isAuthorized(request)) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  try {
    const { id, status } = await request.json();

    const allowed = ['Confirmed', 'Completed', 'Cancelled'];
    if (!id || !allowed.includes(status)) {
      return NextResponse.json(
        { error: `Status must be one of: ${allowed.join(', ')}` },
        { status: 400 }
      );
    }

    // If cancelling, free the time slot so someone else can book it
    if (status === 'Cancelled') {
      await sql`
        UPDATE TimeSlots
        SET    is_booked = FALSE
        WHERE  id = (SELECT slot_id FROM Appointments WHERE id = ${id})
      `;
    }

    const result = await sql`
      UPDATE Appointments
      SET    status = ${status}
      WHERE  id     = ${id}
      RETURNING id, status
    `;

    if (result.length === 0) {
      return NextResponse.json({ error: 'Appointment not found.' }, { status: 404 });
    }

    return NextResponse.json({ success: true, appointment: result[0] });
  } catch (error) {
    console.error('Update booking error:', error);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}