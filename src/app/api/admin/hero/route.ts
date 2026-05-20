import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { del } from '@vercel/blob';

export const dynamic = 'force-dynamic';

function isAuthorized(request: Request): boolean {
  return request.headers.get('authorization') === `Bearer ${process.env.ADMIN_SECRET}`;
}

// ── GET: Fetch all hero slides ─────────────────────────────────────────────
export async function GET(request: Request) {
  if (!isAuthorized(request)) return new NextResponse('Unauthorized', { status: 401 });

  try {
    const slides = await sql`
      SELECT * FROM HeroSlides 
      ORDER BY display_order ASC, created_at DESC
    `;
    return NextResponse.json({ success: true, slides });
  } catch (error) {
    console.error('Fetch hero slides error:', error);
    return NextResponse.json({ error: 'Failed to fetch slides.' }, { status: 500 });
  }
}

// ── POST: Save a new slide to the database ────────────────────────────────
export async function POST(request: Request) {
  if (!isAuthorized(request)) return new NextResponse('Unauthorized', { status: 401 });

  try {
    const { image_url, title, description } = await request.json();

    if (!image_url || !title || !description) {
      return NextResponse.json({ error: 'Image, title, and description are required.' }, { status: 400 });
    }

    const result = await sql`
      INSERT INTO HeroSlides (image_url, title, description)
      VALUES (${image_url}, ${title}, ${description})
      RETURNING *
    `;

    return NextResponse.json({ success: true, slide: result[0] });
  } catch (error) {
    console.error('Save slide error:', error);
    return NextResponse.json({ error: 'Failed to save slide.' }, { status: 500 });
  }
}

// ── DELETE: Remove slide from Database AND Vercel Blob ────────────────────────
export async function DELETE(request: Request) {
  if (!isAuthorized(request)) return new NextResponse('Unauthorized', { status: 401 });

  try {
    const { id, image_url } = await request.json();

    // 1. Delete from Database
    await sql`DELETE FROM HeroSlides WHERE id = ${id}`;

    // 2. Delete from Vercel Blob to keep storage clean
    if (image_url) {
      await del(image_url);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Delete slide error:', error);
    return NextResponse.json({ error: 'Failed to delete slide.' }, { status: 500 });
  }
}