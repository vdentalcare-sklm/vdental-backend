import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { sendOutreachTemplate } from '@/lib/whatsapp';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { name, phone, email, reason } = body;

    if (!name || !phone) {
      return NextResponse.json(
        { error: 'Name and phone are required.' },
        { status: 400 }
      );
    }

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

    const patientResult = await sql`
      INSERT INTO Patients (name, phone, email)
      VALUES (${name.trim()}, ${whatsappPhone}, ${email?.trim() ?? null})
      ON CONFLICT (phone) DO UPDATE
        SET name  = EXCLUDED.name,
            email = COALESCE(EXCLUDED.email, Patients.email)
      RETURNING id
    `;
    const patientId = patientResult[0].id;

    // Create pending appointment with no branch yet —
    // branch will be set once the patient picks one on WhatsApp
    await sql`
      INSERT INTO Appointments (patient_id, reason, status)
      VALUES (${patientId}, ${reason?.trim() ?? null}, 'Pending')
    `;

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