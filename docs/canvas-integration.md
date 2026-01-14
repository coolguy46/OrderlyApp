# Canvas Integration Guide

This guide explains how to use the Canvas LMS integration to automatically import assignments from your Canvas calendar.

## Overview

The Canvas integration allows you to:
- Import assignments from Canvas via iCal calendar feed
- Automatically convert Canvas events to tasks
- Track assignments by course, type, and due date
- Sync with one click - no OAuth required

## Setup Instructions

### 1. Database Migration

First, run the database migration to add Canvas support:

1. Open your Supabase project dashboard
2. Go to SQL Editor
3. Run the migration file: `lib/supabase/canvas-migration.sql`

Alternatively, if you're setting up from scratch, the main `schema.sql` file already includes Canvas support.

### 2. Get Your Canvas Calendar URL

To get your Canvas calendar feed URL:

1. Log in to Canvas
2. Go to **Calendar** (in the left sidebar)
3. Click the **Calendar Feed** button (usually in the bottom right)
4. Copy the calendar feed URL (it looks like: `https://canvas.instructure.com/feeds/calendars/user_xxxxx.ics`)

**Important Notes:**
- The URL is unique to you and contains your Canvas user ID
- Keep this URL private - anyone with it can view your assignments
- You can regenerate the URL if it's compromised

### 3. Connect Canvas

1. Navigate to **Settings → Integrations** in your app
2. Find the **Canvas LMS** card
3. Paste your calendar feed URL
4. Click **Sync**

The integration will:
- Fetch your Canvas calendar
- Parse all events (assignments, exams, quizzes, etc.)
- Import upcoming assignments as tasks
- Display statistics about your courses

## Features

### Assignment Types

The integration automatically categorizes assignments:
- **Exam/Test/Final** → High priority exam tasks
- **Quiz** → Quiz tasks
- **Discussion** → Discussion tasks
- **Other** → General assignments

### Course Detection

The parser extracts course names from Canvas assignment titles, which typically follow the format:
```
Assignment Name [p+ Course Name - 25-26/YR]
```

### Date Filtering

By default, the integration only imports:
- Assignments with due dates
- Upcoming assignments (not past due dates)

This prevents cluttering your task list with old assignments.

### Status Tracking

Assignments are categorized by status:
- **Upcoming** - Due in more than 7 days
- **In Progress** - Due within 7 days
- **Overdue** - Past due date

## Usage Examples

### Basic Sync

```typescript
import { syncCanvasCalendar } from '@/lib/integrations/canvas';

const assignments = await syncCanvasCalendar('https://canvas.instructure.com/feeds/calendars/user_xxx.ics');
console.log(`Found ${assignments.length} assignments`);
```

### Filter by Date Range

```typescript
import { filterAssignmentsByDateRange } from '@/lib/integrations/canvas';

const startDate = new Date('2026-01-01');
const endDate = new Date('2026-01-31');

const januaryAssignments = filterAssignmentsByDateRange(assignments, startDate, endDate);
```

### Group by Course

```typescript
import { groupAssignmentsByCourse } from '@/lib/integrations/canvas';

const courseGroups = groupAssignmentsByCourse(assignments);
for (const [courseName, courseAssignments] of Object.entries(courseGroups)) {
  console.log(`${courseName}: ${courseAssignments.length} assignments`);
}
```

### Get Upcoming Assignments

```typescript
import { getUpcomingAssignments } from '@/lib/integrations/canvas';

const upcoming = getUpcomingAssignments(assignments);
console.log(`${upcoming.length} assignments due in the next 7 days`);
```

## API Reference

### Canvas Types

```typescript
interface CanvasAssignment {
  id: string;                    // Unique Canvas event ID
  courseId?: string;             // Extracted course ID
  courseName: string;            // Course name
  title: string;                 // Assignment title
  description?: string;          // Assignment description
  dueDate?: Date;               // Due date
  startDate?: Date;             // Start date
  endDate?: Date;               // End date
  url?: string;                 // Canvas assignment URL
  type: 'assignment' | 'exam' | 'quiz' | 'discussion' | 'other';
  status: 'upcoming' | 'in_progress' | 'overdue' | 'completed';
}
```

### Main Functions

#### `syncCanvasCalendar(icalUrl: string): Promise<CanvasAssignment[]>`
Fetches and parses Canvas calendar from iCal URL.

#### `parseICalFile(icalContent: string): CanvasAssignment[]`
Parses iCal file content into Canvas assignments.

#### `fetchICalFromUrl(url: string): Promise<string>`
Fetches raw iCal file content from URL.

#### `filterAssignmentsByDateRange(assignments, startDate?, endDate?): CanvasAssignment[]`
Filters assignments by date range.

#### `groupAssignmentsByCourse(assignments): Record<string, CanvasAssignment[]>`
Groups assignments by course name.

#### `sortAssignmentsByDueDate(assignments, ascending?): CanvasAssignment[]`
Sorts assignments by due date.

#### `getUpcomingAssignments(assignments): CanvasAssignment[]`
Returns assignments due within the next 7 days.

#### `getOverdueAssignments(assignments): CanvasAssignment[]`
Returns overdue assignments.

## API Endpoints

### POST `/api/canvas/sync`

Syncs Canvas calendar and returns assignments.

**Request:**
```json
{
  "icalUrl": "https://canvas.instructure.com/feeds/calendars/user_xxx.ics"
}
```

**Response:**
```json
{
  "success": true,
  "count": 25,
  "assignments": [
    {
      "id": "event-assignment-191379",
      "courseName": "A.P. Statistics - 25-26/YR",
      "title": "Sem 1 Review",
      "dueDate": "2025-12-15T00:00:00.000Z",
      "type": "assignment",
      "status": "upcoming",
      "url": "https://moreau.instructure.com/calendar?..."
    }
  ]
}
```

## Database Schema

### Tasks Table (Extended)

The `tasks` table includes Canvas-specific fields:

```sql
CREATE TABLE tasks (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  due_date TIMESTAMP WITH TIME ZONE,
  
  -- Canvas integration fields
  source TEXT DEFAULT 'manual',           -- 'manual', 'google_classroom', 'canvas'
  external_id TEXT,                        -- Canvas UID
  external_url TEXT,                       -- Link to Canvas
  course_name TEXT,                        -- Course name
  assignment_type TEXT,                    -- 'assignment', 'exam', etc.
  
  UNIQUE(user_id, source, external_id)    -- Prevent duplicates
);
```

### Canvas Settings Table

```sql
CREATE TABLE canvas_settings (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE,
  ical_url TEXT NOT NULL,
  last_sync_at TIMESTAMP WITH TIME ZONE,
  sync_enabled BOOLEAN DEFAULT true,
  auto_import_assignments BOOLEAN DEFAULT true
);
```

## Troubleshooting

### "Failed to fetch iCal file"
- Check that your Canvas URL is correct
- Ensure the URL is accessible (not behind authentication)
- Verify your internet connection

### "Invalid URL format"
- Make sure you copied the entire URL
- The URL should start with `https://`
- The URL should end with `.ics`

### No assignments imported
- Check that you have upcoming assignments in Canvas
- The integration skips past assignments
- Verify assignments have due dates set

### Duplicate assignments
- The database uses unique constraints to prevent duplicates
- Each Canvas assignment (by UID) is imported only once per user
- Re-syncing won't create duplicates

## Security Notes

- **Keep your iCal URL private** - it contains your user ID
- The URL allows read-only access to your calendar
- You can regenerate the URL in Canvas if compromised
- URLs are stored securely in your Supabase database
- All database operations use Row Level Security (RLS)

## Example iCal File

Here's what a Canvas iCal event looks like:

```ical
BEGIN:VEVENT
DTSTAMP:20251216T231700Z
UID:event-assignment-191379
DTSTART;VALUE=DATE:20251215
CLASS:PUBLIC
DESCRIPTION:Semester 1 Final Review...
SUMMARY:Sem 1 Review [p+ A.P. Statistics - 25-26/YR]
URL:https://canvas.instructure.com/calendar?...
END:VEVENT
```

The parser extracts:
- **UID** → Assignment ID
- **DTSTART** → Due date
- **SUMMARY** → Title and course name
- **DESCRIPTION** → Assignment details
- **URL** → Link to Canvas

## Future Enhancements

Potential features for future versions:
- Automatic periodic syncing
- Submission status tracking
- Grade import
- Assignment notifications
- Multiple Canvas accounts
- Course filtering options

## Support

For issues or questions:
1. Check this documentation
2. Review the example iCal file attached to understand the format
3. Check browser console for errors
4. Verify Canvas URL is correct

## License

This integration is part of your student time management platform.
