// app/api/book/route.ts
import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { sendOutreachTemplate } from '@/lib/whatsapp';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { name, phone, email, reason } = body;

// ── Validation ─────────────────────────────────────────────────────────
    if (!name || !phone) {
      return NextResponse.json(
        { error: 'Name and phone are required.' },
        { status: 400 }
      );
    }

    // Strip all non-numeric characters (removes +, spaces, dashes)
    let cleanPhone = String(phone).replace(/\D/g, '');

    // If they included the Indian country code (91) making it 12 digits, remove the 91
    if (cleanPhone.length === 12 && cleanPhone.startsWith('91')) {
      cleanPhone = cleanPhone.substring(2);
    } 
    // If they added a leading zero making it 11 digits, remove the 0
    else if (cleanPhone.length === 11 && cleanPhone.startsWith('0')) {
      cleanPhone = cleanPhone.substring(1);
    }

    // Now strictly check if the remaining number is exactly 10 digits starting with 6-9
    if (!/^[6-9]\d{9}$/.test(cleanPhone)) {
      return NextResponse.json(
        { error: 'Enter a valid Indian mobile number.' },
        { status: 400 }
      );
    }

    // Format for Meta API
    const whatsappPhone = `91${cleanPhone}`;

    // ── Upsert patient ──────────────────────────────────────────────────────
    const patientResult = await sql`
      INSERT INTO Patients (name, phone, email)
      VALUES (${name.trim()}, ${whatsappPhone}, ${email?.trim() ?? null})
      ON CONFLICT (phone) DO UPDATE
        SET name  = EXCLUDED.name,
            email = COALESCE(EXCLUDED.email, Patients.email)
      RETURNING id
    `;
    const patientId = patientResult[0].id;

    // ── Create pending appointment ──────────────────────────────────────────
    await sql`
      INSERT INTO Appointments (patient_id, reason, status)
      VALUES (${patientId}, ${reason?.trim() ?? null}, 'Pending')
    `;

    // ── Send initiation template ────────────────────────────────────────────
    // The clinic sends the first WhatsApp message automatically.
    // Template "booking_initiation" must be approved in Meta dashboard.
    // {{1}} = patient name, {{2}} = reason for visit
    // When the patient replies to this message, the 24-hour free window
    // opens and the webhook sends the slot list at no cost.
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
      message: 'Appointment initiated. WhatsApp message sent.',
    });

  } catch (error) {
    console.error('Booking API error:', error);
    return NextResponse.json(
      { error: 'Internal server error. Please try again.' },
      { status: 500 }
    );
  }
}