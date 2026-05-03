// app/api/webhook/meta/route.ts
import { NextResponse } from 'next/server';
import { after } from 'next/server';
import { createHmac, timingSafeEqual } from 'crypto';
import { sql } from '@/lib/db';
import { sendSlotSelectionList, sendWhatsAppText, sendToMetaList } from '@/lib/whatsapp';
import { getAvailableSlots, isDateBlocked } from '@/lib/slots';

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

// ─── Date helpers ─────────────────────────────────────────────────────────────

function getTodayIST(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

/**
 * Returns the next N available (non-blocked) clinic dates starting from today.
 * Skips fully blocked dates.
 */
async function getUpcomingDates(count = 6): Promise<{ value: string; label: string }[]> {
  const dates: { value: string; label: string }[] = [];
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));

  let d = new Date(now);
  let checked = 0;

  while (dates.length < count && checked < 30) {
    const iso = d.toLocaleDateString('en-CA'); // YYYY-MM-DD

    const blocked = await isDateBlocked(iso);
    if (!blocked) {
      const label = d.toLocaleDateString('en-IN', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        timeZone: 'Asia/Kolkata',
      });
      dates.push({ value: iso, label });
    }

    d.setDate(d.getDate() + 1);
    checked++;
  }

  return dates;
}

// ─── Send date selection list ─────────────────────────────────────────────────

async function sendDateSelectionList(to: string): Promise<void> {
  const dates = await getUpcomingDates(10);

  if (dates.length === 0) {
    await sendWhatsAppText(
      to,
      'Sorry, the clinic has no available dates in the next few days. Please call us at +91 8977383622.'
    );
    return;
  }

  const rows = dates.map(d => ({
    id: `DATE_${d.value}`,       // e.g. DATE_2026-05-10
    title: d.label,              // e.g. "Sat, 10 May"
    description: d.value === getTodayIST() ? 'Today' : '',
  }));

  await sendToMetaList(to, {
    header: 'Select a Date',
    body: 'Please choose your preferred appointment date:',
    footer: 'Day & Night Dental Clinic',
    buttonLabel: 'View Dates',
    sectionTitle: 'Available Dates',
    rows,
  });
}

// ─── GET: Webhook verification ────────────────────────────────────────────────

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

  after(async () => {
    try {
      const body = JSON.parse(rawBody);
      if (body.object !== 'whatsapp_business_account') return;

      const changes  = body.entry?.[0]?.changes?.[0]?.value;
      const messages = changes?.messages;
      if (!messages || messages.length === 0) return;

      const msg         = messages[0];
      const senderPhone = msg.from;

      // ── Scenario A: Plain text message ───────────────────────────────────────
      if (msg.type === 'text') {
        const textBody = (msg.text.body as string).toLowerCase();
        if (textBody.includes('booking request') || textBody.includes('book')) {
          await sendDateSelectionList(senderPhone);
        } else {
          await sendWhatsAppText(
            senderPhone,
            'Hi! To book an appointment, please visit our website and fill in the booking form.'
          );
        }
      }

      // ── Scenario A.2: Patient taps "View Slots" quick reply on template ──────
      // This is the button on the booking_initiation template
      if (msg.type === 'interactive' && msg.interactive?.type === 'button_reply') {
        const buttonTitle = (msg.interactive.button_reply.title as string).toLowerCase();
        if (buttonTitle === 'view slots') {
          // Send date list first, not time slots directly
          await sendDateSelectionList(senderPhone);
        }
      }

      // ── Scenario B: Patient selects from an interactive list ─────────────────
      if (msg.type === 'interactive' && msg.interactive?.type === 'list_reply') {
        const selectedId    = msg.interactive.list_reply.id as string;
        const selectedTitle = msg.interactive.list_reply.title as string;

        // ── B.1: Patient picked a DATE ──────────────────────────────────────────
        if (selectedId.startsWith('DATE_')) {
          const selectedDate = selectedId.replace('DATE_', ''); // e.g. 2026-05-10

          const blocked = await isDateBlocked(selectedDate);
          if (blocked) {
            await sendWhatsAppText(
              senderPhone,
              `Sorry, ${selectedTitle} is not available. Please choose another date:`
            );
            await sendDateSelectionList(senderPhone);
            return;
          }

          const slots = await getAvailableSlots(selectedDate);

          if (slots.length === 0) {
            await sendWhatsAppText(
              senderPhone,
              `Sorry, there are no available slots on ${selectedTitle}. Please choose another date:`
            );
            await sendDateSelectionList(senderPhone);
            return;
          }

          await sendSlotSelectionList(senderPhone, slots);
          return;
        }

        // ── B.2: Patient picked a TIME SLOT ────────────────────────────────────
        if (selectedId.startsWith('SLOT_')) {
          const selectedSlotId = parseInt(selectedId.replace('SLOT_', ''), 10);

          if (isNaN(selectedSlotId)) {
            console.error('Could not parse slot ID from:', selectedId);
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

          // Slot was taken in a race condition
          if (lockResult.length === 0) {
            const slotRow = await sql`SELECT date FROM TimeSlots WHERE id = ${selectedSlotId}`;
            const date    = slotRow[0]?.date as string ?? getTodayIST();
            const remaining = await getAvailableSlots(date);

            if (remaining.length === 0) {
              await sendWhatsAppText(
                senderPhone,
                '⚠️ Sorry, that slot was just taken and no others are available for that day. Please choose a different date:'
              );
              await sendDateSelectionList(senderPhone);
            } else {
              await sendWhatsAppText(senderPhone, '⚠️ Sorry, that slot was just taken. Please choose another time:');
              await sendSlotSelectionList(senderPhone, remaining);
            }
            return;
          }

          // Find patient by phone
          const patientResult = await sql`SELECT id FROM Patients WHERE phone = ${senderPhone}`;

          if (patientResult.length === 0) {
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
            `✅ *Appointment Confirmed!*\n\nYour appointment is scheduled for:\n📅 *${dateStr}*\n🕐 *${selectedTitle}*\n\nPlease arrive 5 minutes early. See you at Day & Night Dental Clinic! 🦷`
          );
        }
      }

    } catch (error) {
      console.error('Webhook processing error:', error);
    }
  });

  return new NextResponse('OK', { status: 200 });
}