// app/api/admin/stats/route.ts
import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';

export async function GET() {
    try {
        // Fetch all campaigns and calculate progress dynamically
        const campaigns = await sql`
            SELECT 
                c.id, 
                c.filename, 
                c.total_count, 
                c.created_at,
                COUNT(q.id) FILTER (WHERE q.status = 'Sent')::int as sent_count,
                COUNT(q.id) FILTER (WHERE q.status = 'Failed')::int as failed_count,
                COUNT(q.id) FILTER (WHERE q.status = 'Pending')::int as pending_count
            FROM OutreachCampaigns c
            LEFT JOIN OutreachQueue q ON c.id = q.campaign_id
            GROUP BY c.id
            ORDER BY c.created_at DESC
        `;

        return NextResponse.json({ success: true, campaigns });
    } catch (error) {
        console.error("Fetch Stats Error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}