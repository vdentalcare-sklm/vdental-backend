import { neon } from '@neondatabase/serverless';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not defined in the environment.');
}

export const sql = neon(process.env.DATABASE_URL);

export async function initializeDatabase() {
  try {
    // 1. Patients
    await sql`
      CREATE TABLE IF NOT EXISTS Patients (
        id             SERIAL PRIMARY KEY,
        name           VARCHAR(255) NOT NULL,
        phone          VARCHAR(20)  UNIQUE NOT NULL,
        email          VARCHAR(255),
        created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        do_not_contact BOOLEAN DEFAULT FALSE
      );
    `;

    // 2. TimeSlots
    await sql`
      CREATE TABLE IF NOT EXISTS TimeSlots (
        id        SERIAL PRIMARY KEY,
        date      DATE NOT NULL,
        time      TIME NOT NULL,
        is_booked BOOLEAN DEFAULT FALSE,
        UNIQUE(date, time)
      );
    `;

    // 3. Appointments
    await sql`
      CREATE TABLE IF NOT EXISTS Appointments (
        id         SERIAL PRIMARY KEY,
        patient_id INTEGER REFERENCES Patients(id),
        slot_id    INTEGER REFERENCES TimeSlots(id),
        reason     TEXT,
        status     VARCHAR(50) DEFAULT 'Pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `;

    // 4. Outreach Campaigns
    await sql`
      CREATE TABLE IF NOT EXISTS OutreachCampaigns (
        id          SERIAL PRIMARY KEY,
        filename    VARCHAR(255) NOT NULL,
        total_count INTEGER DEFAULT 0,
        sent_count  INTEGER DEFAULT 0,
        created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `;

    // 5. Outreach Queue
    await sql`
      CREATE TABLE IF NOT EXISTS OutreachQueue (
        id              SERIAL PRIMARY KEY,
        campaign_id     INTEGER REFERENCES OutreachCampaigns(id),
        patient_name    VARCHAR(255),
        phone           VARCHAR(20) NOT NULL,
        disease         TEXT,
        status          VARCHAR(50) DEFAULT 'Pending',
        meta_message_id VARCHAR(255),
        created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        sent_at         TIMESTAMP,
        delivered_at    TIMESTAMP
      );
    `;

    // 6. Blocked Dates — entire day marked as unavailable
    await sql`
      CREATE TABLE IF NOT EXISTS BlockedDates (
        id     SERIAL PRIMARY KEY,
        date   DATE NOT NULL UNIQUE,
        reason TEXT
      );
    `;

    // 7. Blocked Slots — individual time slots marked as unavailable
    await sql`
      CREATE TABLE IF NOT EXISTS BlockedSlots (
        id     SERIAL PRIMARY KEY,
        date   DATE NOT NULL,
        time   TIME NOT NULL,
        reason TEXT,
        UNIQUE(date, time)
      );
    `;

    // 8. Hero Slides
    await sql`
      CREATE TABLE IF NOT EXISTS HeroSlides (
        id SERIAL PRIMARY KEY,
        image_url TEXT NOT NULL,
        title VARCHAR(255) NOT NULL,
        description TEXT NOT NULL,
        display_order INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `;

    // ── Indexes ───────────────────────────────────────────────────────────────
    await sql`CREATE INDEX IF NOT EXISTS idx_appointments_patient_id      ON Appointments(patient_id);`;
    await sql`CREATE INDEX IF NOT EXISTS idx_appointments_status          ON Appointments(status);`;
    await sql`CREATE INDEX IF NOT EXISTS idx_outreach_queue_campaign_status ON OutreachQueue(campaign_id, status);`;
    await sql`CREATE INDEX IF NOT EXISTS idx_outreach_queue_status        ON OutreachQueue(status);`;
    await sql`CREATE INDEX IF NOT EXISTS idx_timeslots_date               ON TimeSlots(date, is_booked);`;
    await sql`CREATE INDEX IF NOT EXISTS idx_blocked_dates_date           ON BlockedDates(date);`;
    await sql`CREATE INDEX IF NOT EXISTS idx_blocked_slots_date           ON BlockedSlots(date);`;

    console.log('Database schema initialized successfully.');
  } catch (error) {
    console.error('Failed to initialize database:', error);
    throw error;
  }
}