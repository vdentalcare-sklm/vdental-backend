import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';

function isAuthorized(request: Request): boolean {
  return request.headers.get('authorization') === `Bearer ${process.env.ADMIN_SECRET}`;
}

// ── GET /api/admin/patients ───────────────────────────────────────────────────
// Query params:
//   ?id=123           — single patient + full booking history
//   ?search=name|phone — search across all patients
//   ?branchId=1        — filter patients who have booked at a specific branch
export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const patientId = searchParams.get('id');
    const search    = searchParams.get('search') ?? '';
    const branchId  = searchParams.get('branchId');

    // ── Single patient + full booking history ─────────────────────────────────
    if (patientId) {
      const patient = await sql`
        SELECT id, name, phone, email, created_at
        FROM   Patients
        WHERE  id = ${patientId}
      `;

      if (patient.length === 0) {
        return NextResponse.json({ error: 'Patient not found.' }, { status: 404 });
      }

      const history = await sql`
        SELECT
          a.id                            AS appointment_id,
          a.reason,
          a.status,
          a.created_at,
          b.id                            AS branch_id,
          b.name                          AS branch_name,
          to_char(t.date, 'YYYY-MM-DD')  AS slot_date,
          to_char(t.time, 'HH12:MI AM')  AS slot_time
        FROM      Appointments a
        JOIN      Branches     b ON a.branch_id  = b.id
        LEFT JOIN TimeSlots    t ON a.slot_id    = t.id
        WHERE     a.patient_id = ${patientId}
        ORDER BY  a.created_at DESC
      `;

      return NextResponse.json({
        success: true,
        patient: patient[0],
        history,
      });
    }

    // ── Patient list with optional search + branch filter ─────────────────────
    const patients = await sql`
      SELECT
        p.id,
        p.name,
        p.phone,
        p.email,
        p.created_at,
        COUNT(a.id)::int                AS total_bookings,
        MAX(to_char(t.date, 'YYYY-MM-DD')) AS last_appointment_date,
        STRING_AGG(DISTINCT b.name, ', ' ORDER BY b.name) AS branches_visited
      FROM      Patients     p
      LEFT JOIN Appointments a ON a.patient_id = p.id
      LEFT JOIN Branches     b ON a.branch_id  = b.id
      LEFT JOIN TimeSlots    t ON a.slot_id    = t.id
      WHERE
        (
          ${search} = ''
          OR p.name  ILIKE ${'%' + search + '%'}
          OR p.phone ILIKE ${'%' + search + '%'}
        )
        AND
        (
          ${branchId ?? null}::integer IS NULL
          OR a.branch_id = ${branchId ?? null}::integer
        )
      GROUP BY p.id
      ORDER BY p.created_at DESC
    `;

    return NextResponse.json({ success: true, patients });

  } catch (error) {
    console.error('Fetch patients error:', error);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}

// ── PATCH /api/admin/patients — update patient details ───────────────────────
// Body: { id: number, name?: string, email?: string }
export async function PATCH(request: Request) {
  if (!isAuthorized(request)) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  try {
    const { id, name, email } = await request.json();

    if (!id) {
      return NextResponse.json({ error: 'id is required.' }, { status: 400 });
    }

    const result = await sql`
      UPDATE Patients
      SET
        name  = COALESCE(${name?.trim()  ?? null}, name),
        email = COALESCE(${email?.trim() ?? null}, email)
      WHERE id = ${id}
      RETURNING id, name, phone, email
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