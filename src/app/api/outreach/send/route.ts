// app/api/outreach/send/route.ts
import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { sendOutreachTemplate } from '@/lib/whatsapp';

// A secure token checked by Vercel to ensure only Vercel can trigger this cron job
const CRON_SECRET = process.env.CRON_SECRET || "development_cron_bypass";

export async function GET(request: Request) {
    // 1. Verify the request is actually from Vercel Cron
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${CRON_SECRET}` && process.env.NODE_ENV === 'production') {
        return new NextResponse("Unauthorized", { status: 401 });
    }

    try {
        // 2. Atomically lock and fetch up to 10 pending messages
        // This prevents double-sending if the cron job overlaps
        const batch = await sql`
            WITH locked_rows AS (
                SELECT id 
                FROM OutreachQueue 
                WHERE status = 'Pending' 
                ORDER BY created_at ASC
                LIMIT 10 
                FOR UPDATE SKIP LOCKED
            )
            UPDATE OutreachQueue 
            SET status = 'Processing' 
            WHERE id IN (SELECT id FROM locked_rows)
            RETURNING id, phone, patient_name, disease, campaign_id;
        `;

        if (batch.length === 0) {
            return NextResponse.json({ message: "No pending outreach messages." });
        }

        // 3. Send the WhatsApp templates
        let successCount = 0;
        let failCount = 0;

        for (const row of batch) {
            try {
                // Template format defined in your architecture doc: 
                // "Hi {{1}}, based on your consultation regarding {{2}}... Book here: {{3}}"
                const bookingLink = "https://yourwebsite.com/appointment"; 
                const variables = [row.patient_name, row.disease, bookingLink];
                
                // sendOutreachTemplate now throws if Meta rejects, and returns { message_id } on success
                const response = await sendOutreachTemplate(row.phone, "marketing_followup", variables);
                
                if (response.message_id) {
                    // Save the meta_message_id so the admin dashboard can track "Delivered" status later
                    await sql`
                        UPDATE OutreachQueue 
                        SET status = 'Sent', 
                            sent_at = CURRENT_TIMESTAMP, 
                            meta_message_id = ${response.message_id} 
                        WHERE id = ${row.id}
                    `;
                    successCount++;
                } else {
                    throw new Error("Meta API succeeded but returned no message ID.");
                }
            } catch (error) {
                console.error(`Failed to send to ${row.phone}:`, error);
                await sql`UPDATE OutreachQueue SET status = 'Failed' WHERE id = ${row.id}`;
                failCount++;
            }
        }

        return NextResponse.json({ 
            message: "Batch processed", 
            processed: batch.length,
            success: successCount,
            failed: failCount
        });

    } catch (error) {
        console.error("Cron Error:", error);
        return new NextResponse("Internal Server Error", { status: 500 });
    }
}