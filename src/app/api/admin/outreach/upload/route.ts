// app/api/admin/outreach/upload/route.ts
import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import * as xlsx from 'xlsx';

export async function POST(request: Request) {
    try {
        const formData = await request.formData();
        const file = formData.get('file') as File;

        if (!file) {
            return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
        }

        // 1. Read the file buffer and parse with SheetJS
        const buffer = await file.arrayBuffer();
        const workbook = xlsx.read(buffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        
        // Expecting Excel columns: Name, Mobile, Disease
        const data: any[] = xlsx.utils.sheet_to_json(sheet);

        if (data.length === 0) {
            return NextResponse.json({ error: "Excel file is empty" }, { status: 400 });
        }

        // 2. Create a new campaign record
        const campaignResult = await sql`
            INSERT INTO OutreachCampaigns (filename, total_count)
            VALUES (${file.name}, ${data.length})
            RETURNING id
        `;
        const campaignId = campaignResult[0].id;

        // 3. Queue the messages
        let insertedCount = 0;
        for (const row of data) {
            // Standardize column names (case-insensitive fallback)
            const name = row.Name || row.name;
            let rawPhone = String(row.Mobile || row.mobile || row.Phone || row.phone).replace(/\D/g, '');
            const disease = row.Disease || row.disease || "Dental Checkup";

            if (!name || !rawPhone) continue;

            // Meta API requires the country code. Prepend '91' for India if missing.
            if (rawPhone.length === 10) rawPhone = `91${rawPhone}`;

            await sql`
                INSERT INTO OutreachQueue (campaign_id, patient_name, phone, disease, status)
                VALUES (${campaignId}, ${name}, ${rawPhone}, ${disease}, 'Pending')
            `;
            insertedCount++;
        }

        return NextResponse.json({ 
            success: true, 
            message: "Campaign queued successfully", 
            campaign_id: campaignId,
            total_queued: insertedCount
        });

    } catch (error) {
        console.error("Upload Error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}