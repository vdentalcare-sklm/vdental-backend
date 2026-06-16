import { sql } from './db';

export async function isDateBlocked(date: string, branchId: number): Promise<boolean> {
  const rows = await sql`
    SELECT 1 FROM BlockedDates 
    WHERE date = ${date}::date 
      AND branch_id = ${branchId}
    LIMIT 1
  `;
  return rows.length > 0;
}

export async function seedSlotsIfNeeded(date: string, branchId: number): Promise<void> {
  const existing = await sql`
    SELECT 1 FROM TimeSlots 
    WHERE date = ${date}::date 
      AND branch_id = ${branchId}
    LIMIT 1
  `;
  if (existing.length > 0) return;

  // 9:00 AM – 9:00 PM, 30-min intervals, same for all branches all days
  const slotsToInsert: string[] = [];
  let h = 9;
  let m = 0;

  while (h < 21) {
    slotsToInsert.push(
      `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
    );
    m += 30;
    if (m === 60) {
      m = 0;
      h++;
    }
  }

  for (const timeStr of slotsToInsert) {
    await sql`
      INSERT INTO TimeSlots (branch_id, date, time, is_booked)
      VALUES (${branchId}, ${date}::date, ${timeStr}::time, FALSE)
      ON CONFLICT DO NOTHING
    `;
  }
}

export async function getAvailableSlots(
  date: string,
  branchId: number
): Promise<{ id: number; time: string }[]> {
  await seedSlotsIfNeeded(date, branchId);

  const todayIST = getTodayIST();

  const nowIST = new Date().toLocaleTimeString('en-GB', {
    timeZone: 'Asia/Kolkata',
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  });

  const rows = await sql`
    SELECT t.id, to_char(t.time, 'HH12:MI AM') AS slot_time
    FROM   TimeSlots t
    WHERE  t.branch_id = ${branchId}
      AND  t.date      = ${date}::date
      AND  t.is_booked = FALSE
      AND  (
        ${date} != ${todayIST}
        OR t.time > ${nowIST}::time
      )
      AND  NOT EXISTS (
        SELECT 1 FROM BlockedSlots b
        WHERE  b.branch_id = ${branchId}
          AND  b.date      = t.date
          AND  b.time      = t.time
      )
    ORDER BY t.time ASC
  `;

  return rows.map((row: any) => ({
    id: Number(row.id),
    time: String(row.slot_time),
  }));
}

export function getTodayIST(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}