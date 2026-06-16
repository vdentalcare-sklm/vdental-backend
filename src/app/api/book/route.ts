import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { sendOutreachTemplate } from '@/lib/whatsapp';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { name, phone, email, reason } = body;

    // ── Validation ────────────────────────────────────────────────────────────
    if (!name || !phone) {
      return NextResponse.json(
        { error: 'Name and phone are required.' },
        { status: 400 }
      );
    }

    // ── Phone sanitization ────────────────────────────────────────────────────
    let cleanPhone = String(phone).replace(/\D/g, '');

    if (cleanPhone.length === 12 && cleanPhone.startsWith('91')) {
      cleanPhone = cleanPhone.substring(2);
    } else if (cleanPhone.length === 11 && cleanPhone.startsWith('0')) {
      cleanPhone = cleanPhone.substring(1);
    }

    if (!/^[6-9]\d{9}$/.test(cleanPhone)) {
      return NextResponse.json(
        { error: 'Enter a valid Indian mobile number.' },
        { status: 400 }
      );
    }

    const whatsappPhone = `91${cleanPhone}`;

    // ── Upsert patient ────────────────────────────────────────────────────────
    const patientResult = await sql`
      INSERT INTO Patients (name, phone, email)
      VALUES (${name.trim()}, ${whatsappPhone}, ${email?.trim() ?? null})
      ON CONFLICT (phone) DO UPDATE
        SET name  = EXCLUDED.name,
            email = COALESCE(EXCLUDED.email, Patients.email)
      RETURNING id
    `;
    const patientId = patientResult[0].id;

    // ── Get default branch (is_main = TRUE) as a fallback ────────────────────
    // The actual branch will be confirmed by the patient via WhatsApp
    const mainBranch = await sql`
      SELECT id FROM Branches WHERE is_main = TRUE AND is_active = TRUE LIMIT 1
    `;

    // If somehow no main branch exists, grab the first active one
    const fallbackBranch = mainBranch.length === 0
      ? await sql`SELECT id FROM Branches WHERE is_active = TRUE ORDER BY display_order ASC LIMIT 1`
      : mainBranch;

    if (fallbackBranch.length === 0) {
      console.error('No active branches found in database.');
      return NextResponse.json(
        { error: 'No branches are currently available. Please call us.' },
        { status: 503 }
      );
    }

    const branchId = fallbackBranch[0].id;

    // ── Create pending appointment ────────────────────────────────────────────
    // Status is Pending — branch will be confirmed/updated via WhatsApp flow
    // slot_id is null until patient picks a time slot on WhatsApp
    await sql`
      INSERT INTO Appointments (patient_id, branch_id, reason, status)
      VALUES (${patientId}, ${branchId}, ${reason?.trim() ?? null}, 'Pending')
    `;

    // ── Send booking initiation template ──────────────────────────────────────
    // This fires the first WhatsApp message to the patient.
    // Template "booking_initiation" must be approved in Meta Business dashboard.
    // {{1}} = patient name, {{2}} = reason for visit
    // When the patient replies, the webhook takes over with Branch → Date → Time flow.
    await sendOutreachTemplate(
      whatsappPhone,
      'booking_initiation',
      [
        name.trim(),
        reason?.trim() || 'your dental visit',
      ]
    );

    return NextResponse.json({
      success: true,
      message: 'Appointment request received. Please check WhatsApp to complete your booking.',
    });

  } catch (error) {
    console.error('Booking API error:', error);
    return NextResponse.json(
      { error: 'Internal server error. Please try again.' },
      { status: 500 }
    );
  }
}