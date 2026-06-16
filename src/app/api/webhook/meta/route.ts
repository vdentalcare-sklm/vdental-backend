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

async function getUpcomingDates(
  count = 10,
  branchId: number
): Promise<{ value: string; label: string }[]> {
  const dates: { value: string; label: string }[] = [];

  const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const [year, month, day] = todayStr.split('-').map(Number);
  let d = new Date(year, month - 1, day);

  let checked = 0;
  while (dates.length < count && checked < 30) {
    const iso =
      d.getFullYear() +
      '-' +
      String(d.getMonth() + 1).padStart(2, '0') +
      '-' +
      String(d.getDate()).padStart(2, '0');

    const blocked = await isDateBlocked(iso, branchId);
    if (!blocked) {
      const label = d.toLocaleDateString('en-IN', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
      });
      dates.push({ value: iso, label });
    }

    d.setDate(d.getDate() + 1);
    checked++;
  }
  return dates;
}

// ─── Send branch selection list ───────────────────────────────────────────────

async function sendBranchSelectionList(to: string): Promise<void> {
  const branches = await sql`
    SELECT id, name, address
    FROM   Branches
    WHERE  is_active = TRUE
    ORDER  BY display_order ASC
  `;

  if (branches.length === 0) {
    await sendWhatsAppText(
      to,
      'Sorry, no branches are currently available. Please call us for assistance.'
    );
    return;
  }

  const rows = branches.map((b: any) => ({
    id: `BRANCH_${b.id}`,
    title: b.name,
    description: b.address,
  }));

  await sendToMetaList(to, {
    header: 'Select a Branch',
    body: 'Please choose your preferred V Dental branch:',
    footer: 'V Dental Hospitals',
    buttonLabel: 'View Branches',
    sectionTitle: 'Our Branches',
    rows,
  });
}

// ─── Send date selection list ─────────────────────────────────────────────────

async function sendDateSelectionList(to: string, branchId: number): Promise<void> {
  const dates = await getUpcomingDates(10, branchId);

  if (dates.length === 0) {
    await sendWhatsAppText(
      to,
      'Sorry, there are no available dates at this branch in the next 30 days. Please call us for assistance.'
    );
    return;
  }

  const rows = dates.map(d => ({
    id: `DATE_${branchId}_${d.value}`,
    title: d.label,
    description: d.value === getTodayIST() ? 'Today' : '',
  }));

  await sendToMetaList(to, {
    header: 'Select a Date',
    body: 'Please choose your preferred appointment date:',
    footer: 'V Dental Hospitals',
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

      // ── Scenario A: Plain text message ──────────────────────────────────────
      if (msg.type === 'text') {
        const textBody = (msg.text.body as string).toLowerCase();

        if (textBody.includes('book') || textBody.includes('appointment')) {
          await sendBranchSelectionList(senderPhone);
        } else {
          const welcomeMessage =
            `Hi there! 👋 Thanks for reaching out to *V Dental Hospitals*.\n\n` +
            `To schedule a consultation, you can book your appointment directly through our website:\n` +
            `🌐 https://www.vdentalcare.in\n\n` +
            `_Alternatively, reply with *"Book"* to book right here on WhatsApp!_\n\n` +
            `For emergencies, please call us at +91 95505 08480.`;

          await sendWhatsAppText(senderPhone, welcomeMessage);
        }
      }

      // ── Scenario A.2: "View Slots" quick reply button on template ───────────
      if (msg.type === 'button') {
        const buttonText = (msg.button.text as string).toLowerCase();
        if (buttonText === 'view slots') {
          await sendBranchSelectionList(senderPhone);
        }
      }

      if (msg.type === 'interactive' && msg.interactive?.type === 'button_reply') {
        const buttonTitle = (msg.interactive.button_reply.title as string).toLowerCase();
        if (buttonTitle === 'view slots') {
          await sendBranchSelectionList(senderPhone);
        }
      }

      // ── Scenario B: Interactive list reply ──────────────────────────────────
      if (msg.type === 'interactive' && msg.interactive?.type === 'list_reply') {
        const selectedId    = msg.interactive.list_reply.id as string;
        const selectedTitle = msg.interactive.list_reply.title as string;

        // ── B.1: Patient picked a BRANCH ──────────────────────────────────────
        if (selectedId.startsWith('BRANCH_')) {
          const branchId = parseInt(selectedId.replace('BRANCH_', ''), 10);

          if (isNaN(branchId)) {
            console.error('Could not parse branch ID from:', selectedId);
            return;
          }

          // Verify branch still exists and is active
          const branch = await sql`
            SELECT id FROM Branches WHERE id = ${branchId} AND is_active = TRUE LIMIT 1
          `;

          if (branch.length === 0) {
            await sendWhatsAppText(
              senderPhone,
              'Sorry, that branch is no longer available. Please choose another:'
            );
            await sendBranchSelectionList(senderPhone);
            return;
          }

          await sendDateSelectionList(senderPhone, branchId);
          return;
        }

        // ── B.2: Patient picked a DATE ────────────────────────────────────────
        if (selectedId.startsWith('DATE_')) {
          // Format: DATE_branchId_YYYY-MM-DD
          const parts      = selectedId.split('_');
          const branchId   = parseInt(parts[1], 10);
          const selectedDate = parts.slice(2).join('_'); // handles the date part safely

          if (isNaN(branchId) || !selectedDate) {
            console.error('Could not parse DATE selection from:', selectedId);
            return;
          }

          const blocked = await isDateBlocked(selectedDate, branchId);
          if (blocked) {
            await sendWhatsAppText(
              senderPhone,
              `Sorry, ${selectedTitle} is not available at this branch. Please choose another date:`
            );
            await sendDateSelectionList(senderPhone, branchId);
            return;
          }

          const slots = await getAvailableSlots(selectedDate, branchId);

          if (slots.length === 0) {
            await sendWhatsAppText(
              senderPhone,
              `Sorry, there are no available slots on ${selectedTitle} at this branch. Please choose another date:`
            );
            await sendDateSelectionList(senderPhone, branchId);
            return;
          }

          await sendSlotSelectionList(senderPhone, slots, selectedDate, branchId, 0);
          return;
        }

        // ── B.3: Pagination — patient tapped "Show Later Times" ───────────────
        if (selectedId.startsWith('MORE_')) {
          // Format: MORE_branchId_date_nextIndex
          const parts     = selectedId.split('_');
          const branchId  = parseInt(parts[1], 10);
          const date      = parts[2];
          const nextIndex = parseInt(parts[3], 10);

          const slots = await getAvailableSlots(date, branchId);
          await sendSlotSelectionList(senderPhone, slots, date, branchId, nextIndex);
          return;
        }

        // ── B.4: Patient picked a TIME SLOT ───────────────────────────────────
        if (selectedId.startsWith('SLOT_')) {
          // Format: SLOT_branchId_slotDbId
          const parts         = selectedId.split('_');
          const branchId      = parseInt(parts[1], 10);
          const selectedSlotId = parseInt(parts[2], 10);

          if (isNaN(selectedSlotId) || isNaN(branchId)) {
            console.error('Could not parse SLOT selection from:', selectedId);
            return;
          }

          // Lock the slot atomically — prevents double-bookings
          const lockResult = await sql`
            UPDATE TimeSlots
            SET    is_booked = TRUE
            WHERE  id        = ${selectedSlotId}
              AND  branch_id = ${branchId}
              AND  is_booked = FALSE
            RETURNING id, date, time
          `;

          // Slot was taken in a race condition
          if (lockResult.length === 0) {
            const slotRow = await sql`
              SELECT date FROM TimeSlots WHERE id = ${selectedSlotId}
            `;
            const date      = slotRow[0]?.date ?? getTodayIST();
            const remaining = await getAvailableSlots(date, branchId);

            if (remaining.length === 0) {
              await sendWhatsAppText(
                senderPhone,
                '⚠️ Sorry, that slot was just taken and no others are available for that day. Please choose a different date:'
              );
              await sendDateSelectionList(senderPhone, branchId);
            } else {
              await sendWhatsAppText(
                senderPhone,
                '⚠️ Sorry, that slot was just taken. Please choose another time:'
              );
              await sendSlotSelectionList(senderPhone, remaining, date, branchId, 0);
            }
            return;
          }

          // Upsert patient
          const profileName =
            body.entry?.[0]?.changes?.[0]?.value?.contacts?.[0]?.profile?.name ||
            'WhatsApp User';

          const patientResult = await sql`
            INSERT INTO Patients (name, phone)
            VALUES (${profileName}, ${senderPhone})
            ON CONFLICT (phone) DO UPDATE SET phone = EXCLUDED.phone
            RETURNING id
          `;
          const patientId = patientResult[0].id;

          // Check for an existing pending appointment for this patient at this branch
          const existingAppointment = await sql`
            SELECT id FROM Appointments
            WHERE  patient_id = ${patientId}
              AND  branch_id  = ${branchId}
              AND  status     = 'Pending'
            ORDER  BY created_at DESC
            LIMIT  1
          `;

          if (existingAppointment.length > 0) {
            await sql`
              UPDATE Appointments
              SET    slot_id = ${selectedSlotId},
                     status  = 'Confirmed'
              WHERE  id      = ${existingAppointment[0].id}
            `;
          } else {
            await sql`
              INSERT INTO Appointments (patient_id, branch_id, slot_id, reason, status)
              VALUES (${patientId}, ${branchId}, ${selectedSlotId}, 'WhatsApp Booking', 'Confirmed')
            `;
          }

          // Format confirmation date
          const slot    = lockResult[0];
          const dateObj = new Date(slot.date);
          const dateStr = new Date(
            dateObj.getFullYear(),
            dateObj.getMonth(),
            dateObj.getDate()
          ).toLocaleDateString('en-IN', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
          });

          // Get branch name for confirmation message
          const branchRow = await sql`
            SELECT name FROM Branches WHERE id = ${branchId} LIMIT 1
          `;
          const branchName = branchRow[0]?.name ?? 'V Dental';

          await sendWhatsAppText(
            senderPhone,
            `✅ *Appointment Confirmed!*\n\nYour appointment is scheduled for:\n📍 *${branchName}*\n📅 *${dateStr}*\n🕐 *${selectedTitle}*\n\nPlease arrive 5 minutes early. See you at V Dental! 🦷`
          );
        }
      }

    } catch (error) {
      console.error('Webhook processing error:', error);
    }
  });

  return new NextResponse('OK', { status: 200 });
}