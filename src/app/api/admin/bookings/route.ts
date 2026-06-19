import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';

function isAuthorized(request: Request): boolean {
  return request.headers.get('authorization') === `Bearer ${process.env.ADMIN_SECRET}`;
}

// ── GET /api/admin/bookings ───────────────────────────────────────────────────
// Query params:
//   ?status=Pending|Confirmed|Completed|Cancelled  (optional)
//   ?branchId=1                                    (optional)
//   ?date=YYYY-MM-DD                               (optional)
export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const status   = searchParams.get('status');
    const branchId = searchParams.get('branchId');
    const date     = searchParams.get('date');

    const bookings = await sql`
      SELECT
        a.id                              AS appointment_id,
        a.reason,
        a.status,
        a.created_at,
        p.id                             AS patient_id,
        p.name                           AS patient_name,
        p.phone                          AS patient_phone,
        p.email                          AS patient_email,
        b.id                             AS branch_id,
        b.name                           AS branch_name,
        t.id                             AS slot_id,
        to_char(t.date, 'YYYY-MM-DD')   AS slot_date,
        to_char(t.time, 'HH12:MI AM')   AS slot_time
FROM      Appointments a
      JOIN      Patients     p ON a.patient_id = p.id
      LEFT JOIN Branches     b ON a.branch_id  = b.id
      LEFT JOIN TimeSlots    t ON a.slot_id    = t.id
      WHERE
        (${status   ?? null}::text    IS NULL OR a.status    = ${status   ?? null}::text)
        AND
        (${branchId ?? null}::integer IS NULL OR a.branch_id = ${branchId ?? null}::integer)
        AND
        (${date     ?? null}::date    IS NULL OR t.date      = ${date     ?? null}::date)
      ORDER BY a.created_at DESC
    `;

    return NextResponse.json({ success: true, bookings });

  } catch (error) {
    console.error('Fetch bookings error:', error);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}

// ── PATCH /api/admin/bookings — update appointment status ─────────────────────
// Body: { id: number, status: "Confirmed"|"Completed"|"Cancelled" }
export async function PATCH(request: Request) {
  if (!isAuthorized(request)) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  try {
    const { id, status } = await request.json();

    const allowed = ['Confirmed', 'Completed', 'Cancelled'];
    if (!id || !allowed.includes(status)) {
      return NextResponse.json(
        { error: `status must be one of: ${allowed.join(', ')}` },
        { status: 400 }
      );
    }

    // If cancelling, free the time slot so someone else can book it
    if (status === 'Cancelled') {
      await sql`
        UPDATE TimeSlots
        SET    is_booked = FALSE
        WHERE  id = (
          SELECT slot_id FROM Appointments WHERE id = ${id}
        )
      `;
    }

    const result = await sql`
      UPDATE Appointments
      SET    status = ${status}
      WHERE  id     = ${id}
      RETURNING id, status, branch_id
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