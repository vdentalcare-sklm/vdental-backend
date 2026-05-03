// app/api/admin/patients/route.ts
import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';

function isAuthorized(request: Request): boolean {
  return request.headers.get('authorization') === `Bearer ${process.env.ADMIN_SECRET}`;
}

// ── GET /api/admin/patients — list all patients ───────────────────────────────
// Optional query params: ?search=name_or_phone  ?id=123 (single patient)
export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const search     = searchParams.get('search') ?? '';
    const patientId  = searchParams.get('id');

    // ── Single patient + booking history ─────────────────────────────────────
    if (patientId) {
      const patient = await sql`
        SELECT id, name, phone, email, created_at, do_not_contact
        FROM   Patients
        WHERE  id = ${patientId}
      `;

      if (patient.length === 0) {
        return NextResponse.json({ error: 'Patient not found.' }, { status: 404 });
      }

      const history = await sql`
        SELECT
          a.id     AS appointment_id,
          a.reason,
          a.status,
          a.created_at,
          t.date   AS slot_date,
          to_char(t.time, 'HH12:MI AM') AS slot_time
        FROM      Appointments a
        LEFT JOIN TimeSlots    t ON a.slot_id = t.id
        WHERE     a.patient_id = ${patientId}
        ORDER BY  a.created_at DESC
      `;

      return NextResponse.json({
        success: true,
        patient: patient[0],
        history,
      });
    }

    // ── Patient list with optional search ─────────────────────────────────────
    const patients = await sql`
      SELECT
        p.id,
        p.name,
        p.phone,
        p.email,
        p.created_at,
        p.do_not_contact,
        COUNT(a.id)::int AS total_bookings,
        MAX(t.date)          AS last_appointment_date
      FROM      Patients     p
      LEFT JOIN Appointments a ON a.patient_id = p.id
      LEFT JOIN TimeSlots    t ON a.slot_id    = t.id
      WHERE
        ${search} = ''
        OR p.name  ILIKE ${'%' + search + '%'}
        OR p.phone ILIKE ${'%' + search + '%'}
      GROUP BY p.id
      ORDER BY p.created_at DESC
    `;

    return NextResponse.json({ success: true, patients });

  } catch (error) {
    console.error('Fetch patients error:', error);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}

// ── PATCH /api/admin/patients — toggle do_not_contact ────────────────────────
export async function PATCH(request: Request) {
  if (!isAuthorized(request)) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  try {
    const { id, do_not_contact } = await request.json();

    if (!id || typeof do_not_contact !== 'boolean') {
      return NextResponse.json(
        { error: 'id and do_not_contact (boolean) are required.' },
        { status: 400 }
      );
    }

    const result = await sql`
      UPDATE Patients
      SET    do_not_contact = ${do_not_contact}
      WHERE  id             = ${id}
      RETURNING id, name, do_not_contact
    `;

    if (result.length === 0) {
      return NextResponse.json({ error: 'Patient not found.' }, { status: 404 });
    }

    return NextResponse.json({ success: true, patient: result[0] });

  } catch (error) {
    console.error('Update patient error:', error);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}