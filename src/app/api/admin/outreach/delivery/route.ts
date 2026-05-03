// app/api/admin/outreach/delivery/route.ts
import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';

function isAuthorized(request: Request): boolean {
  return request.headers.get('authorization') === `Bearer ${process.env.ADMIN_SECRET}`;
}

// GET /api/admin/outreach/delivery?campaignId=X
export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return new NextResponse('Unauthorized', { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const campaignId = searchParams.get('campaignId');

    if (!campaignId) {
      return NextResponse.json(
        { error: 'campaignId query param is required.' },
        { status: 400 }
      );
    }

    const rows = await sql`
      SELECT
        id,
        patient_name,
        phone,
        disease,
        status,
        sent_at,
        meta_message_id
      FROM   OutreachQueue
      WHERE  campaign_id = ${campaignId}
      ORDER  BY created_at ASC
    `;

    return NextResponse.json({ success: true, rows });

  } catch (error) {
    console.error('Fetch delivery error:', error);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}