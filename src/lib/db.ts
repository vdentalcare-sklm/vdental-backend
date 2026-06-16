import { neon } from '@neondatabase/serverless';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not defined in the environment.');
}

export const sql = neon(process.env.DATABASE_URL);

export async function initializeDatabase() {
  try {

    // 1. Branches
    await sql`
      CREATE TABLE IF NOT EXISTS Branches (
        id            SERIAL PRIMARY KEY,
        name          VARCHAR(255) NOT NULL,
        address       TEXT NOT NULL,
        phone         VARCHAR(20) NOT NULL,
        hours         VARCHAR(100) NOT NULL DEFAULT 'Mon – Sun | 9:00 AM – 9:00 PM',
        map_src       TEXT,
        is_main       BOOLEAN DEFAULT FALSE,
        is_active     BOOLEAN DEFAULT TRUE,
        display_order INTEGER DEFAULT 0,
        created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `;

    // 2. Patients
    await sql`
      CREATE TABLE IF NOT EXISTS Patients (
        id             SERIAL PRIMARY KEY,
        name           VARCHAR(255) NOT NULL,
        phone          VARCHAR(20) UNIQUE NOT NULL,
        email          VARCHAR(255),
        created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `;

    // 3. TimeSlots (branch-scoped)
    await sql`
      CREATE TABLE IF NOT EXISTS TimeSlots (
        id        SERIAL PRIMARY KEY,
        branch_id INTEGER NOT NULL REFERENCES Branches(id) ON DELETE CASCADE,
        date      DATE NOT NULL,
        time      TIME NOT NULL,
        is_booked BOOLEAN DEFAULT FALSE,
        UNIQUE(branch_id, date, time)
      );
    `;

    // 4. Appointments (branch-scoped)
    await sql`
      CREATE TABLE IF NOT EXISTS Appointments (
        id         SERIAL PRIMARY KEY,
        patient_id INTEGER NOT NULL REFERENCES Patients(id),
        branch_id  INTEGER NOT NULL REFERENCES Branches(id),
        slot_id    INTEGER REFERENCES TimeSlots(id),
        reason     TEXT,
        status     VARCHAR(50) DEFAULT 'Pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `;

    // 5. BlockedDates (branch-scoped)
    await sql`
      CREATE TABLE IF NOT EXISTS BlockedDates (
        id        SERIAL PRIMARY KEY,
        branch_id INTEGER NOT NULL REFERENCES Branches(id) ON DELETE CASCADE,
        date      DATE NOT NULL,
        reason    TEXT,
        UNIQUE(branch_id, date)
      );
    `;

    // 6. BlockedSlots (branch-scoped)
    await sql`
      CREATE TABLE IF NOT EXISTS BlockedSlots (
        id        SERIAL PRIMARY KEY,
        branch_id INTEGER NOT NULL REFERENCES Branches(id) ON DELETE CASCADE,
        date      DATE NOT NULL,
        time      TIME NOT NULL,
        reason    TEXT,
        UNIQUE(branch_id, date, time)
      );
    `;

    // 7. HeroSlides
    await sql`
      CREATE TABLE IF NOT EXISTS HeroSlides (
        id            SERIAL PRIMARY KEY,
        image_url     TEXT NOT NULL,
        title         VARCHAR(255) NOT NULL,
        description   TEXT NOT NULL,
        display_order INTEGER DEFAULT 0,
        created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `;

    // 8. GalleryImages
    await sql`
      CREATE TABLE IF NOT EXISTS GalleryImages (
        id            SERIAL PRIMARY KEY,
        image_url     TEXT NOT NULL,
        alt_text      VARCHAR(255) DEFAULT 'Gallery Image',
        display_order INTEGER DEFAULT 0,
        created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `;

    // 9. BlogPosts
    await sql`
      CREATE TABLE IF NOT EXISTS BlogPosts (
        id           SERIAL PRIMARY KEY,
        title        VARCHAR(255) NOT NULL,
        slug         VARCHAR(255) NOT NULL UNIQUE,
        category     VARCHAR(100),
        excerpt      TEXT,
        content_html TEXT,
        image_url    TEXT,
        author       VARCHAR(255) DEFAULT 'V Dental Team',
        is_published BOOLEAN DEFAULT TRUE,
        is_featured  BOOLEAN DEFAULT FALSE,
        created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `;

    // 10. TeamMembers
    await sql`
      CREATE TABLE IF NOT EXISTS TeamMembers (
        id            SERIAL PRIMARY KEY,
        name          VARCHAR(255) NOT NULL,
        role          VARCHAR(255) NOT NULL,
        image_url     TEXT NOT NULL,
        display_order INTEGER DEFAULT 0,
        created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `;

    // 11. Videos
    await sql`
      CREATE TABLE IF NOT EXISTS Videos (
        id            SERIAL PRIMARY KEY,
        youtube_id    VARCHAR(50) NOT NULL,
        title         TEXT NOT NULL,
        duration      VARCHAR(20),
        is_featured   BOOLEAN DEFAULT FALSE,
        display_order INTEGER DEFAULT 0,
        created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `;

    // ── Indexes ───────────────────────────────────────────────────────────────
    await sql`CREATE INDEX IF NOT EXISTS idx_timeslots_branch_date        ON TimeSlots(branch_id, date, is_booked);`;
    await sql`CREATE INDEX IF NOT EXISTS idx_appointments_patient_id      ON Appointments(patient_id);`;
    await sql`CREATE INDEX IF NOT EXISTS idx_appointments_branch_id       ON Appointments(branch_id);`;
    await sql`CREATE INDEX IF NOT EXISTS idx_appointments_status          ON Appointments(status);`;
    await sql`CREATE INDEX IF NOT EXISTS idx_blocked_dates_branch_date    ON BlockedDates(branch_id, date);`;
    await sql`CREATE INDEX IF NOT EXISTS idx_blocked_slots_branch_date    ON BlockedSlots(branch_id, date);`;
    await sql`CREATE INDEX IF NOT EXISTS idx_blogposts_slug               ON BlogPosts(slug);`;
    await sql`CREATE INDEX IF NOT EXISTS idx_blogposts_published          ON BlogPosts(is_published);`;
    await sql`CREATE INDEX IF NOT EXISTS idx_videos_featured              ON Videos(is_featured);`;

    console.log('Database schema initialized successfully.');
  } catch (error) {
    console.error('Failed to initialize database:', error);
    throw error;
  }
}