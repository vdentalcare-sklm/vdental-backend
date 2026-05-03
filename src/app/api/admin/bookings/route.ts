// app/api/admin/bookings/route.ts
import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';

export async function GET() {
    try {
        const bookings = await sql`
            SELECT 
                a.id AS appointment_id,
                a.reason,
                a.status,
                a.created_at,
                p.name AS patient_name,
                p.phone AS patient_phone,
                t.date AS slot_date,
                t.time AS slot_time
            FROM Appointments a
            JOIN Patients p ON a.patient_id = p.id
            LEFT JOIN TimeSlots t ON a.slot_id = t.id
            ORDER BY a.created_at DESC
        `;

        return NextResponse.json({ success: true, bookings });
    } catch (error) {
        console.error("Fetch Bookings Error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}