import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const slides = await sql`
      SELECT id, image_url, title, description 
      FROM HeroSlides 
      ORDER BY display_order ASC, created_at DESC
    `;
    return NextResponse.json({ success: true, slides });
  } catch (error) {
    console.error('Failed to fetch public hero slides:', error);
    return NextResponse.json(
      { error: 'Failed to load hero slides' }, 
      { status: 500 }
    );
  }
}