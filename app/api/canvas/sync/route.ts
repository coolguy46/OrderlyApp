import { NextRequest, NextResponse } from 'next/server';
import { syncCanvasCalendar } from '@/lib/integrations/canvas';

/**
 * POST /api/canvas/sync
 * Syncs Canvas calendar from iCal URL
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { icalUrl } = body;

    if (!icalUrl || typeof icalUrl !== 'string') {
      return NextResponse.json(
        { error: 'iCal URL is required' },
        { status: 400 }
      );
    }

    // Validate URL format
    try {
      new URL(icalUrl);
    } catch {
      return NextResponse.json(
        { error: 'Invalid URL format' },
        { status: 400 }
      );
    }

    // Sync calendar
    const assignments = await syncCanvasCalendar(icalUrl);

    return NextResponse.json({
      success: true,
      count: assignments.length,
      assignments,
    });
  } catch (error) {
    console.error('Canvas sync error:', error);
    
    return NextResponse.json(
      { 
        error: 'Failed to sync Canvas calendar',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/canvas/sync
 * Returns sync status and instructions
 */
export async function GET() {
  return NextResponse.json({
    message: 'Canvas iCal sync endpoint',
    instructions: {
      method: 'POST',
      body: {
        icalUrl: 'Your Canvas calendar iCal URL'
      },
      example: 'https://canvas.instructure.com/feeds/calendars/user_xxx.ics'
    }
  });
}
