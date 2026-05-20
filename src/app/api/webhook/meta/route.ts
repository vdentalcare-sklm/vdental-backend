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

async function getUpcomingDates(count = 6): Promise<{ value: string; label: string }[]> {
  const dates: { value: string; label: string }[] = [];
  
  // 1. Get Today's YYYY-MM-DD string specifically in IST
  const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  
  // 2. Break it into numbers to create a "Local" Date object (prevents 7 PM roll-over)
  const [year, month, day] = todayStr.split('-').map(Number);
  let d = new Date(year, month - 1, day); 
  
  let checked = 0;
  while (dates.length < count && checked < 30) {
    // 3. Format back to YYYY-MM-DD manually
    const iso = d.getFullYear() + '-' + 
                String(d.getMonth() + 1).padStart(2, '0') + '-' + 
                String(d.getDate()).padStart(2, '0');

    const blocked = await isDateBlocked(iso);
    if (!blocked) {
      const label = d.toLocaleDateString('en-IN', {
        weekday: 'short',
        day: 'numeric',
        month: 'short'
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
          // New welcoming fallback message for random texts like "Hi"
          const welcomeMessage = 
            `Hi there! 👋 Thanks for reaching out to *Day & Night Dental Clinic*.\n\n` +
            `To schedule a consultation, you can easily book your appointment directly through our website:\n` +
            `🌐 https://www.dayandnightdentalclinic.com\n\n` + 
            `_Alternatively, if you want to book right here on WhatsApp, just reply to this message with the word *"Book"*!_\n\n` +
            `For emergencies, please call us at +91 8977383622.`;

          await sendWhatsAppText(senderPhone, welcomeMessage);
        }
      }

      // ── Scenario A.2: Patient taps "View Slots" quick reply on template ──────
      // This is the button on the booking_initiation template
if (msg.type === 'button') {
  const buttonText = (msg.button.text as string).toLowerCase();
  if (buttonText === 'view slots') {
    await sendDateSelectionList(senderPhone);
  }
}

if (msg.type === 'interactive' && msg.interactive?.type === 'button_reply') {
  const buttonTitle = (msg.interactive.button_reply.title as string).toLowerCase();
  if (buttonTitle === 'view slots') {
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

          await sendSlotSelectionList(senderPhone, slots, selectedDate, 0);
          return;
        }

              // ── B.1.5: Pagination — patient tapped "Show Later Times" ──────────────
if (selectedId.startsWith('MORE_')) {
  const parts      = selectedId.split('_');
  const date       = parts[1];
  const nextIndex  = parseInt(parts[2], 10);
  const slots      = await getAvailableSlots(date);
  await sendSlotSelectionList(senderPhone, slots, date, nextIndex);
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
              await sendSlotSelectionList(senderPhone, remaining, date, 0);
            }
            return;
          }

          
          // Find patient by phone
          const patientResult = await sql`SELECT id FROM Patients WHERE phone = ${senderPhone}`;

          if (patientResult.length === 0) {
            // Grab their actual WhatsApp name instead of using 'Unknown'
            const profileName = body.entry?.[0]?.changes?.[0]?.value?.contacts?.[0]?.profile?.name || 'WhatsApp User';

            const newPatient = await sql`
              INSERT INTO Patients (name, phone)
              VALUES (${profileName}, ${senderPhone})
              ON CONFLICT (phone) DO UPDATE SET phone = EXCLUDED.phone
              RETURNING id
            `;
            
            // Add a default "reason" so the database doesn't reject it
            await sql`
              INSERT INTO Appointments (patient_id, slot_id, status, reason)
              VALUES (${newPatient[0].id}, ${selectedSlotId}, 'Confirmed', 'WhatsApp Widget Booking')
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
              // Add the default "reason" here too!
              await sql`
                INSERT INTO Appointments (patient_id, slot_id, status, reason)
                VALUES (${patientId}, ${selectedSlotId}, 'Confirmed', 'WhatsApp Widget Booking')
              `;
            }
          }
// Inside Scenario B.2: Patient picked a TIME SLOT
const slot = lockResult[0];

// If slot.date is already a Date object or a string from SQL:
const dateObj = new Date(slot.date);
const sYear = dateObj.getFullYear();
const sMonth = dateObj.getMonth() + 1; // getMonth is 0-indexed
const sDay = dateObj.getDate();

const dateStr = new Date(sYear, sMonth - 1, sDay).toLocaleDateString('en-IN', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
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