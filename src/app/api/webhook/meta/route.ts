// app/api/webhook/meta/route.ts
import { NextResponse } from 'next/server';
import { after } from 'next/server';
import { createHmac, timingSafeEqual } from 'crypto';
import { sql } from '@/lib/db';
import { sendSlotSelectionList, sendWhatsAppText } from '@/lib/whatsapp';
import { getAvailableSlots, getTodayIST, isDateBlocked } from '@/lib/slots';

// ─── Signature verification ───────────────────────────────────────────────────

function verifyMetaSignature(rawBody: string, signature: string | null): boolean {
  if (!signature || !process.env.META_APP_SECRET) return false;

  const expected = 'sha256=' + createHmac('sha256', process.env.META_APP_SECRET)
    .update(rawBody, 'utf8')
    .digest('hex');

  try {
    return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

// ─── Shared helper: send slot list or appropriate fallback message ─────────────

async function sendSlotsOrFallback(senderPhone: string): Promise<void> {
  const today = getTodayIST();

  // Check if the entire day is blocked first
  const blocked = await isDateBlocked(today);
  if (blocked) {
    await sendWhatsAppText(
      senderPhone,
      'Sorry, the clinic is closed today. Please call us at +91 8977383622 to arrange a time.'
    );
    return;
  }

  const slots = await getAvailableSlots(today);

  if (slots.length === 0) {
    await sendWhatsAppText(
      senderPhone,
      'Sorry, there are no available slots for today. Please call us at +91 8977383622 to arrange a time.'
    );
    return;
  }

  await sendSlotSelectionList(senderPhone, slots);
}

// ─── GET: Webhook verification (required by Meta on first setup) ──────────────

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const mode      = searchParams.get('hub.mode');
  const token     = searchParams.get('hub.verify_token');
  const challenge = searchParams.get('hub.challenge');

  if (mode === 'subscribe' && token === process.env.META_WEBHOOK_VERIFY_TOKEN) {
    return new NextResponse(challenge, { status: 200 });
  }

  return new NextResponse('Forbidden', { status: 403 });
}

// ─── POST: Handle incoming WhatsApp messages ──────────────────────────────────

export async function POST(request: Request) {
  const rawBody   = await request.text();
  const signature = request.headers.get('x-hub-signature-256');

  if (!verifyMetaSignature(rawBody, signature)) {
    console.warn('Invalid Meta webhook signature — request rejected.');
    return new NextResponse('Forbidden', { status: 403 });
  }

  // Return 200 immediately — Meta requires this within a few seconds
  after(async () => {
    try {
      const body = JSON.parse(rawBody);

      if (body.object !== 'whatsapp_business_account') return;

      const changes  = body.entry?.[0]?.changes?.[0]?.value;
      const messages = changes?.messages;

      if (!messages || messages.length === 0) return;

      const msg         = messages[0];
      const senderPhone = msg.from;

      // ── Scenario A: Patient sends a text message ────────────────────────────
      if (msg.type === 'text') {
        const textBody = (msg.text.body as string).toLowerCase();

        if (textBody.includes('booking request')) {
          await sendSlotsOrFallback(senderPhone);
        } else {
          await sendWhatsAppText(
            senderPhone,
            'Hi! To book an appointment, please use the link on our website and tap the "Book on WhatsApp" button.'
          );
        }
      }

      // ── Scenario A.2: Patient taps "View Slots" quick reply button ──────────
      if (msg.type === 'interactive' && msg.interactive?.type === 'button_reply') {
        const buttonTitle = msg.interactive.button_reply.title;
        if (buttonTitle === 'View Slots') {
          await sendSlotsOrFallback(senderPhone);
        }
      }

      // ── Scenario B: Patient selects a slot from the interactive list ────────
      if (msg.type === 'interactive' && msg.interactive?.type === 'list_reply') {
        const rawId          = msg.interactive.list_reply.id as string;
        const selectedSlotId = parseInt(rawId.replace('SLOT_', ''), 10);
        const selectedTime   = msg.interactive.list_reply.title as string;

        if (isNaN(selectedSlotId)) {
          console.error('Could not parse slot ID from:', rawId);
          return;
        }

        // Lock the slot atomically — prevents double-bookings
        const lockResult = await sql`
          UPDATE TimeSlots
          SET    is_booked = TRUE
          WHERE  id        = ${selectedSlotId}
            AND  is_booked = FALSE
          RETURNING id, date, time
        `;

        // Slot was already taken — race condition
        if (lockResult.length === 0) {
          const today          = getTodayIST();
          const remainingSlots = await getAvailableSlots(today);

          if (remainingSlots.length === 0) {
            await sendWhatsAppText(
              senderPhone,
              '⚠️ Sorry, that slot was just taken and no other slots are available today. Please call us at +91 8977383622.'
            );
          } else {
            await sendWhatsAppText(senderPhone, '⚠️ Sorry, that slot was just taken. Please choose another:');
            await sendSlotSelectionList(senderPhone, remainingSlots);
          }
          return;
        }

        // Find patient by phone
        const patientResult = await sql`
          SELECT id FROM Patients WHERE phone = ${senderPhone}
        `;

        if (patientResult.length === 0) {
          // Patient messaged directly without using the form — create minimal record
          const newPatient = await sql`
            INSERT INTO Patients (name, phone)
            VALUES ('Unknown', ${senderPhone})
            ON CONFLICT (phone) DO UPDATE SET phone = EXCLUDED.phone
            RETURNING id
          `;
          await sql`
            INSERT INTO Appointments (patient_id, slot_id, status)
            VALUES (${newPatient[0].id}, ${selectedSlotId}, 'Confirmed')
          `;
        } else {
          const patientId = patientResult[0].id;

          // Link most recent Pending appointment to this slot
          const updated = await sql`
            UPDATE Appointments
            SET    slot_id = ${selectedSlotId},
                   status  = 'Confirmed'
            WHERE  id = (
              SELECT id FROM Appointments
              WHERE  patient_id = ${patientId}
                AND  status     = 'Pending'
              ORDER  BY created_at DESC
              LIMIT  1
            )
            RETURNING id
          `;

          // No pending appointment — create one
          if (updated.length === 0) {
            await sql`
              INSERT INTO Appointments (patient_id, slot_id, status)
              VALUES (${patientId}, ${selectedSlotId}, 'Confirmed')
            `;
          }
        }

        // Send confirmation
        const slot    = lockResult[0];
        const dateStr = new Date(slot.date as string).toLocaleDateString('en-IN', {
          weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Kolkata',
        });

        await sendWhatsAppText(
          senderPhone,
          `✅ *Appointment Confirmed!*\n\nYour appointment is scheduled for:\n📅 *${dateStr}*\n🕐 *${selectedTime}*\n\nPlease arrive 5 minutes early. See you at Day & Night Dental Clinic! 🦷`
        );
      }

    } catch (error) {
      console.error('Webhook processing error:', error);
    }
  });

  return new NextResponse('OK', { status: 200 });
}