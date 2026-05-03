import { sql } from './db';

export async function isDateBlocked(date: string): Promise<boolean> {
  const rows = await sql`
    SELECT 1 FROM BlockedDates WHERE date = ${date}::date LIMIT 1
  `;
  return rows.length > 0;
}

export async function seedSlotsIfNeeded(date: string): Promise<void> {
  // Fixed: cast to ::date so Postgres does proper date comparison
  const existing = await sql`
    SELECT 1 FROM TimeSlots WHERE date = ${date}::date LIMIT 1
  `;
  if (existing.length > 0) return;

  const dayOfWeek = new Date(date + 'T00:00:00').getUTCDay(); // 0 = Sun

  // Clinic hours:
  // Mon–Sat: 9:00 AM – 7:30 PM (last slot)
  // Sunday:  9:00 AM – 1:00 PM (emergency only, but still seed slots)
  const endHour   = dayOfWeek === 0 ? 13 : 19;
  const endMinute = dayOfWeek === 0 ?  0 : 30;

  const slots: string[] = [];
  // Fixed: start at 9:00 AM (was 9:30 AM)
  let h = 9, m = 0;
  while (h < endHour || (h === endHour && m <= endMinute)) {
    slots.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
    m += 30;
    if (m === 60) { m = 0; h++; }
  }

  for (const time of slots) {
    await sql`
      INSERT INTO TimeSlots (date, time, is_booked)
      VALUES (${date}::date, ${time}::time, FALSE)
      ON CONFLICT DO NOTHING
    `;
  }
}

export async function getAvailableSlots(
  date: string
): Promise<{ id: number; time: string }[]> {
  await seedSlotsIfNeeded(date);

  const rows = await sql`
    SELECT t.id, to_char(t.time, 'HH12:MI AM') AS time
    FROM   TimeSlots t
    WHERE  t.date      = ${date}::date
      AND  t.is_booked = FALSE
      AND  NOT EXISTS (
        SELECT 1 FROM BlockedSlots b
        WHERE  b.date = t.date AND b.time = t.time
      )
    ORDER BY t.time ASC
  `;

  return rows.map(row => ({
    id:   row.id   as number,
    time: row.time as string,
  }));
}

export function getTodayIST(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}