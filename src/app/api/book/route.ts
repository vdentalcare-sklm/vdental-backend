// app/api/book/route.ts
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

    // Validate Indian mobile number (10 digits starting with 6–9)
    const cleanPhone = String(phone).replace(/\D/g, '');
    if (!/^[6-9]\d{9}$/.test(cleanPhone)) {
      return NextResponse.json(
        { error: 'Enter a valid 10-digit Indian mobile number.' },
        { status: 400 }
      );
    }

    // Meta API needs the country code prefix
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

    // ── Create pending appointment ────────────────────────────────────────────
    await sql`
      INSERT INTO Appointments (patient_id, reason, status)
      VALUES (${patientId}, ${reason?.trim() ?? null}, 'Pending')
    `;

    // ── SEND THE INITIATION TEMPLATE (2. ADDED THIS BLOCK) ───────────────────
    // This triggers the first message to the patient automatically via Meta!
    // Variables match {{1}} and {{2}} in your Meta template
    const variables = [name.trim(), reason?.trim() || "your dental visit"];
    await sendOutreachTemplate(whatsappPhone, "booking_initiation", variables);

    return NextResponse.json({
      success: true,
      message: 'Appointment initiated. WhatsApp message sent.',
      whatsapp_phone: whatsappPhone,
    });

  } catch (error) {
    console.error('Booking API error:', error);
    return NextResponse.json(
      { error: 'Internal server error. Please try again.' },
      { status: 500 }
    );
  }
}