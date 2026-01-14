// Canvas Integration Service
// This module handles Canvas calendar integration via iCal format

export interface CanvasAssignment {
  id: string;
  courseId?: string;
  courseName: string;
  title: string;
  description?: string;
  dueDate?: Date;
  startDate?: Date;
  endDate?: Date;
  url?: string;
  type: 'assignment' | 'exam' | 'quiz' | 'discussion' | 'other';
  status: 'upcoming' | 'in_progress' | 'overdue' | 'completed';
}

interface ICalEvent {
  uid: string;
  summary: string;
  description?: string;
  htmlDescription?: string; // X-ALT-DESC for rich HTML content
  dtstart?: string;
  dtend?: string;
  url?: string;
  sequence?: string;
  dtstamp?: string;
}

/**
 * Parse iCal/ICS file content and extract Canvas assignments
 */
export function parseICalFile(icalContent: string): CanvasAssignment[] {
  const assignments: CanvasAssignment[] = [];
  
  // Split into individual events
  const events = icalContent.split('BEGIN:VEVENT');
  
  events.forEach((eventBlock, index) => {
    if (index === 0) return; // Skip the header
    
    const event = parseEvent(eventBlock);
    if (event) {
      const assignment = convertEventToAssignment(event);
      assignments.push(assignment);
    }
  });
  
  return assignments;
}

/**
 * Parse a single VEVENT block
 */
function parseEvent(eventBlock: string): ICalEvent | null {
  const event: ICalEvent = {
    uid: '',
    summary: '',
  };
  
  // First, handle line continuations by joining folded lines
  // iCal spec: lines starting with space or tab are continuations
  const unfoldedContent = eventBlock.replace(/\r?\n[ \t]/g, '');
  const lines = unfoldedContent.split(/\r?\n/);
  
  for (const line of lines) {
    const trimmedLine = line.trim();
    
    if (trimmedLine === 'END:VEVENT' || trimmedLine === '') continue;
    
    // Parse key-value pair
    const colonIndex = trimmedLine.indexOf(':');
    if (colonIndex > 0) {
      const fullKey = trimmedLine.substring(0, colonIndex);
      const value = trimmedLine.substring(colonIndex + 1);
      
      // Handle properties with parameters (e.g., DTSTART;VALUE=DATE:20251215 or X-ALT-DESC;FMTTYPE=text/html:...)
      const semicolonIndex = fullKey.indexOf(';');
      const baseKey = semicolonIndex > 0 ? fullKey.substring(0, semicolonIndex) : fullKey;
      
      setEventProperty(event, baseKey, value, fullKey);
    }
  }
  
  return event.uid ? event : null;
}

/**
 * Set property on event object
 */
function setEventProperty(event: ICalEvent, key: string, value: string, fullKey?: string) {
  // Decode escaped characters
  const decodedValue = value
    .replace(/\\n/g, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\');
  
  switch (key) {
    case 'UID':
      event.uid = decodedValue;
      break;
    case 'SUMMARY':
      event.summary = decodedValue;
      break;
    case 'DESCRIPTION':
      event.description = decodedValue;
      break;
    case 'X-ALT-DESC':
      // Check if it's HTML format
      if (fullKey?.includes('FMTTYPE=text/html')) {
        event.htmlDescription = decodedValue;
      }
      break;
    case 'DTSTART':
      event.dtstart = decodedValue;
      break;
    case 'DTEND':
      event.dtend = decodedValue;
      break;
    case 'URL':
      event.url = decodedValue;
      break;
    case 'SEQUENCE':
      event.sequence = decodedValue;
      break;
    case 'DTSTAMP':
      event.dtstamp = decodedValue;
      break;
  }
}

/**
 * Parse iCal date/time format to JavaScript Date
 */
function parseICalDate(dateString?: string): Date | undefined {
  if (!dateString) return undefined;
  
  // Remove VALUE=DATE if present
  const cleanDate = dateString.replace(/VALUE=DATE[;:]*/g, '');
  
  // Format: YYYYMMDD or YYYYMMDDTHHMMSSZ
  if (cleanDate.length === 8) {
    // Date only (YYYYMMDD)
    const year = parseInt(cleanDate.substring(0, 4));
    const month = parseInt(cleanDate.substring(4, 6)) - 1; // JS months are 0-indexed
    const day = parseInt(cleanDate.substring(6, 8));
    return new Date(year, month, day);
  } else if (cleanDate.includes('T')) {
    // DateTime format (YYYYMMDDTHHMMSSZ)
    const year = parseInt(cleanDate.substring(0, 4));
    const month = parseInt(cleanDate.substring(4, 6)) - 1;
    const day = parseInt(cleanDate.substring(6, 8));
    const hour = parseInt(cleanDate.substring(9, 11));
    const minute = parseInt(cleanDate.substring(11, 13));
    const second = parseInt(cleanDate.substring(13, 15));
    
    if (cleanDate.endsWith('Z')) {
      return new Date(Date.UTC(year, month, day, hour, minute, second));
    } else {
      return new Date(year, month, day, hour, minute, second);
    }
  }
  
  return undefined;
}

/**
 * Extract course name from Canvas assignment title
 * Format: "Assignment Name [p+ Course Name - Year]" or "Assignment Name [p Course Name]"
 */
function extractCourseName(summary: string): string {
  const match = summary.match(/\[p\+?\s*(.+?)\s*(?:-\s*\d{2}-\d{2})?(?:\/[A-Z0-9]+)?\]/);
  return match ? match[1].trim() : 'Unknown Course';
}

/**
 * Remove course name from assignment title
 */
function cleanAssignmentTitle(summary: string): string {
  return summary.replace(/\s*\[p\+?[^\]]+\]\s*$/, '').trim();
}

/**
 * Determine assignment type from title and description
 */
function determineAssignmentType(summary: string, description?: string): CanvasAssignment['type'] {
  const lowerSummary = summary.toLowerCase();
  const lowerDesc = (description || '').toLowerCase();
  
  if (lowerSummary.includes('exam') || lowerSummary.includes('final') || lowerSummary.includes('test')) {
    return 'exam';
  }
  if (lowerSummary.includes('quiz')) {
    return 'quiz';
  }
  if (lowerSummary.includes('discussion') || lowerDesc.includes('discussion')) {
    return 'discussion';
  }
  
  return 'assignment';
}

/**
 * Determine assignment status based on dates
 */
function determineStatus(dueDate?: Date): CanvasAssignment['status'] {
  if (!dueDate) return 'upcoming';
  
  const now = new Date();
  const dayInMs = 24 * 60 * 60 * 1000;
  const diffInDays = (dueDate.getTime() - now.getTime()) / dayInMs;
  
  if (diffInDays < 0) {
    return 'overdue';
  } else if (diffInDays <= 7) {
    return 'in_progress';
  } else {
    return 'upcoming';
  }
}

/**
 * Convert parsed iCal event to Canvas assignment
 */
function convertEventToAssignment(event: ICalEvent): CanvasAssignment {
  const courseName = extractCourseName(event.summary);
  const title = cleanAssignmentTitle(event.summary);
  const dueDate = parseICalDate(event.dtstart);
  const endDate = parseICalDate(event.dtend);
  const type = determineAssignmentType(event.summary, event.description);
  const status = determineStatus(dueDate);
  
  // Extract course ID from URL if available
  let courseId: string | undefined;
  if (event.url) {
    const courseMatch = event.url.match(/course[s]?[_\/](\d+)/);
    if (courseMatch) {
      courseId = courseMatch[1];
    }
  }
  
  // Prefer HTML description if available, otherwise use plain text
  // HTML description typically contains richer formatting from Canvas
  const description = event.htmlDescription || event.description;
  
  return {
    id: event.uid,
    courseId,
    courseName,
    title,
    description,
    dueDate,
    startDate: dueDate, // For Canvas, start date is typically the due date
    endDate,
    url: event.url,
    type,
    status,
  };
}

/**
 * Fetch iCal file from URL
 */
export async function fetchICalFromUrl(url: string): Promise<string> {
  try {
    const response = await fetch(url, {
      headers: {
        'Accept': 'text/calendar, text/plain, */*',
      },
    });
    
    if (!response.ok) {
      throw new Error(`Failed to fetch iCal file: ${response.status} ${response.statusText}`);
    }
    
    const content = await response.text();
    return content;
  } catch (error) {
    throw new Error(`Failed to fetch iCal file: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Sync Canvas calendar by fetching and parsing iCal file
 */
export async function syncCanvasCalendar(icalUrl: string): Promise<CanvasAssignment[]> {
  const icalContent = await fetchICalFromUrl(icalUrl);
  return parseICalFile(icalContent);
}

/**
 * Filter assignments by date range
 */
export function filterAssignmentsByDateRange(
  assignments: CanvasAssignment[],
  startDate?: Date,
  endDate?: Date
): CanvasAssignment[] {
  return assignments.filter((assignment) => {
    if (!assignment.dueDate) return true;
    
    if (startDate && assignment.dueDate < startDate) return false;
    if (endDate && assignment.dueDate > endDate) return false;
    
    return true;
  });
}

/**
 * Group assignments by course
 */
export function groupAssignmentsByCourse(
  assignments: CanvasAssignment[]
): Record<string, CanvasAssignment[]> {
  return assignments.reduce((acc, assignment) => {
    const courseName = assignment.courseName;
    if (!acc[courseName]) {
      acc[courseName] = [];
    }
    acc[courseName].push(assignment);
    return acc;
  }, {} as Record<string, CanvasAssignment[]>);
}

/**
 * Sort assignments by due date
 */
export function sortAssignmentsByDueDate(
  assignments: CanvasAssignment[],
  ascending: boolean = true
): CanvasAssignment[] {
  return [...assignments].sort((a, b) => {
    if (!a.dueDate && !b.dueDate) return 0;
    if (!a.dueDate) return 1;
    if (!b.dueDate) return -1;
    
    const diff = a.dueDate.getTime() - b.dueDate.getTime();
    return ascending ? diff : -diff;
  });
}

/**
 * Get upcoming assignments (within next 7 days)
 */
export function getUpcomingAssignments(assignments: CanvasAssignment[]): CanvasAssignment[] {
  const now = new Date();
  const weekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  
  return assignments.filter((assignment) => {
    if (!assignment.dueDate) return false;
    return assignment.dueDate >= now && assignment.dueDate <= weekFromNow;
  });
}

/**
 * Get overdue assignments
 */
export function getOverdueAssignments(assignments: CanvasAssignment[]): CanvasAssignment[] {
  const now = new Date();
  
  return assignments.filter((assignment) => {
    if (!assignment.dueDate) return false;
    return assignment.dueDate < now && assignment.status !== 'completed';
  });
}
