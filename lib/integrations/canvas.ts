// Canvas Integration Service
// This module handles Canvas calendar integration via iCal format

export interface CanvasAssignment {
  id: string;
  courseId?: string;
  courseName: string;
  title: string;
  description?: string;
  dueDate?: Date;
  /** Original YYYY-MM-DD value for all-day iCal events. */
  dueDateOnly?: string;
  hasDueTime: boolean;
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
  dtstartProperty?: string;
  dtend?: string;
  dtendProperty?: string;
  url?: string;
  sequence?: string;
  dtstamp?: string;
}

/**
 * Parse iCal/ICS file content and extract Canvas assignments
 */
export function parseICalFile(icalContent: string): CanvasAssignment[] {
  const assignments: CanvasAssignment[] = [];
  const calendarTimeZone = icalContent.match(/^X-WR-TIMEZONE:(.+)$/mi)?.[1].trim();
  
  // Split into individual events
  const events = icalContent.split('BEGIN:VEVENT');
  
  events.forEach((eventBlock, index) => {
    if (index === 0) return; // Skip the header
    
    const event = parseEvent(eventBlock);
    if (event) {
      const assignment = convertEventToAssignment(event, calendarTimeZone);
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
      event.dtstartProperty = fullKey;
      break;
    case 'DTEND':
      event.dtend = decodedValue;
      event.dtendProperty = fullKey;
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
interface ParsedICalDate {
  date: Date;
  dateOnly?: string;
  hasTime: boolean;
}

function zonedDateTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone: string
): Date {
  const utcGuess = Date.UTC(year, month, day, hour, minute, second);
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });

  const getOffset = (timestamp: number) => {
    const parts = Object.fromEntries(
      formatter.formatToParts(new Date(timestamp)).map(({ type, value }) => [type, value])
    );
    const representedAsUtc = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second)
    );
    return representedAsUtc - timestamp;
  };

  let result = utcGuess - getOffset(utcGuess);
  // Recalculate once to handle a DST boundary between the guess and result.
  result = utcGuess - getOffset(result);
  const resolved = Object.fromEntries(
    formatter.formatToParts(new Date(result)).map(({ type, value }) => [type, value])
  );
  if (
    Number(resolved.year) !== year
    || Number(resolved.month) !== month + 1
    || Number(resolved.day) !== day
    || Number(resolved.hour) !== hour
    || Number(resolved.minute) !== minute
    || Number(resolved.second) !== second
  ) {
    // A spring-forward gap (for example 02:30 on a day that jumps from
    // 01:59 to 03:00) has no corresponding instant. Silently shifting it by an
    // hour changes the assignment deadline, so reject it instead.
    throw new RangeError('The local calendar time does not exist in this timezone');
  }
  return new Date(result);
}

function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || year < 1 || year > 9999) return false;
  if (!Number.isInteger(month) || month < 1 || month > 12) return false;
  if (!Number.isInteger(day) || day < 1) return false;

  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= daysInMonth[month - 1];
}

/**
 * Rebuild a parsed Canvas due date in the user's timezone. Canvas often sends
 * all-day assignments as a date without a time; those are due at 11:59 PM,
 * not at noon or midnight on the server.
 */
export function hydrateCanvasDueDate(
  assignment: Pick<CanvasAssignment, 'dueDate' | 'dueDateOnly'>,
  timeZone?: string
): Date | undefined {
  if (!assignment.dueDateOnly) {
    if (!assignment.dueDate) return undefined;
    const dueDate = new Date(assignment.dueDate);
    return Number.isNaN(dueDate.getTime()) ? undefined : dueDate;
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(assignment.dueDateOnly)) return undefined;
  const [year, month, day] = assignment.dueDateOnly.split('-').map(Number);
  if (!isValidCalendarDate(year, month, day)) return undefined;

  if (timeZone) {
    try {
      return zonedDateTimeToUtc(year, month - 1, day, 23, 59, 0, timeZone);
    } catch {
      // A supplied but invalid timezone must not silently become the server's
      // timezone, because that can move an all-day assignment by many hours.
      return undefined;
    }
  }

  return new Date(`${assignment.dueDateOnly}T23:59:00`);
}

/** Parse an iCal DATE or DATE-TIME without depending on the server's timezone. */
function parseICalDate(
  dateString?: string,
  property?: string,
  calendarTimeZone?: string
): ParsedICalDate | undefined {
  if (!dateString) return undefined;

  const cleanDate = dateString.trim();
  const declaredValue = property?.match(/(?:^|;)VALUE=([^;:]+)/i)?.[1].toUpperCase();
  const isDateOnly = declaredValue === 'DATE' || (!declaredValue && /^\d{8}$/.test(cleanDate));
  if (isDateOnly && !/^\d{8}$/.test(cleanDate)) return undefined;
  const year = Number(cleanDate.substring(0, 4));
  const calendarMonth = Number(cleanDate.substring(4, 6));
  const month = calendarMonth - 1;
  const day = Number(cleanDate.substring(6, 8));

  if (!isValidCalendarDate(year, calendarMonth, day)) return undefined;

  if (isDateOnly) {
    const dateOnly = `${String(year).padStart(4, '0')}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    // Noon UTC is only a transport value. The client reconstructs date-only
    // events in its local timezone from dateOnly, avoiding a previous-day shift.
    return { date: new Date(Date.UTC(year, month, day, 12)), dateOnly, hasTime: false };
  }

  if (!/^\d{8}T\d{4}(?:\d{2})?Z?$/.test(cleanDate)) return undefined;

  const hour = Number(cleanDate.substring(9, 11));
  const minute = Number(cleanDate.substring(11, 13));
  const second = cleanDate.length >= 15 ? Number(cleanDate.substring(13, 15)) : 0;
  if (
    !Number.isInteger(hour) || hour < 0 || hour > 23
    || !Number.isInteger(minute) || minute < 0 || minute > 59
    || !Number.isInteger(second) || second < 0 || second > 59
  ) return undefined;

  if (cleanDate.endsWith('Z')) {
    return { date: new Date(Date.UTC(year, month, day, hour, minute, second)), hasTime: true };
  }

  const propertyTimeZone = property?.match(/(?:^|;)TZID=(?:"([^"]+)"|([^;:]+))/i);
  const timeZone = propertyTimeZone?.[1] || propertyTimeZone?.[2] || calendarTimeZone;

  if (timeZone) {
    try {
      return { date: zonedDateTimeToUtc(year, month, day, hour, minute, second, timeZone), hasTime: true };
    } catch {
      // An invalid TZID or nonexistent DST wall time is not safely convertible.
      return undefined;
    }
  }

  return { date: new Date(Date.UTC(year, month, day, hour, minute, second)), hasTime: true };
}

/**
 * Extract course name from Canvas assignment title
 * Format: "Assignment Name [p+ Course Name - Year]" or "Assignment Name [p Course Name]"
 */
function extractCourseName(summary: string): string {
  const match = summary.match(/\[([^\]]+)\]\s*$/);
  if (!match) return 'Unknown Course';

  return match[1]
    .trim()
    .replace(/^\*?\s*p\+?\s+/i, '')
    .replace(/^\*\s*/, '')
    .replace(/\s*-\s*\d{2}-\d{2}(?:\/[A-Z0-9]+)?\s*$/i, '')
    .trim() || 'Unknown Course';
}

/**
 * Remove course name from assignment title
 */
function cleanAssignmentTitle(summary: string): string {
  return summary.replace(/\s*\[[^\]]+\]\s*$/, '').trim();
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
function convertEventToAssignment(event: ICalEvent, calendarTimeZone?: string): CanvasAssignment {
  const courseName = extractCourseName(event.summary);
  const title = cleanAssignmentTitle(event.summary);
  const parsedDueDate = parseICalDate(event.dtstart, event.dtstartProperty, calendarTimeZone);
  const parsedEndDate = parseICalDate(event.dtend, event.dtendProperty, calendarTimeZone);
  const dueDate = parsedDueDate?.date;
  const endDate = parsedEndDate?.date;
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
    dueDateOnly: parsedDueDate?.dateOnly,
    hasDueTime: parsedDueDate?.hasTime ?? false,
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
