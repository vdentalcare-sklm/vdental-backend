import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { del } from '@vercel/blob';

export const dynamic = 'force-dynamic';

function isAuthorized(request: Request): boolean {
  return request.headers.get('authorization') === `Bearer ${process.env.ADMIN_SECRET}`;
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) return new NextResponse('Unauthorized', { status: 401 });

  try {
    const posts = await sql`
        SELECT id, title, slug, excerpt, image_url, category, author, is_featured, created_at 
        FROM BlogPosts 
        WHERE is_published = TRUE 
        ORDER BY created_at DESC
      `;
    return NextResponse.json({ success: true, posts });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch blogs.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) return new NextResponse('Unauthorized', { status: 401 });

  try {
    const body = await request.json();
    const { title, slug, category, excerpt, content_html, image_url, author } = body;

    const result = await sql`
      INSERT INTO BlogPosts (title, slug, category, excerpt, content_html, image_url, author)
      VALUES (${title}, ${slug}, ${category}, ${excerpt}, ${content_html}, ${image_url}, ${author || 'Day & Night Team'})
      RETURNING *
    `;
    return NextResponse.json({ success: true, post: result[0] });
  } catch (error: any) {
    // Check for unique slug conflict
    if (error.code === '23505') {
      return NextResponse.json({ error: 'A blog with this slug already exists.' }, { status: 400 });
    }
    return NextResponse.json({ error: 'Failed to save blog post.' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  if (!isAuthorized(request)) return new NextResponse('Unauthorized', { status: 401 });

  try {
    const { id, image_url } = await request.json();
    await sql`DELETE FROM BlogPosts WHERE id = ${id}`;
    if (image_url) await del(image_url); // Delete from Vercel Blob
    
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to delete blog.' }, { status: 500 });
  }
}