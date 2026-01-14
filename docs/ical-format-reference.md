# iCal Format Reference

## Overview

iCalendar (iCal) is a standard format (RFC 5545) for calendar data exchange. Canvas exports calendar data in this format.

## File Structure

```
BEGIN:VCALENDAR
  [Calendar properties]
  BEGIN:VEVENT
    [Event properties]
  END:VEVENT
  [More events...]
END:VCALENDAR
```

## Calendar Properties

```ical
VERSION:2.0
PRODID:icalendar-ruby
CALSCALE:GREGORIAN
METHOD:PUBLISH
X-WR-CALNAME:Student Name Calendar (Canvas)
X-WR-CALDESC:Calendar events for the user
```

## Event (VEVENT) Properties

### Required Properties

- **UID**: Unique identifier for the event
  - Example: `event-assignment-191379`
  - Used to prevent duplicate imports

- **DTSTAMP**: Creation/modification timestamp
  - Format: `20251216T231700Z`
  - UTC time with 'Z' suffix

- **SUMMARY**: Event title/name
  - Example: `Sem 1 Review [p+ A.P. Statistics - 25-26/YR]`
  - Contains both assignment name and course name

### Optional Properties

- **DTSTART**: Start date/time
  - Date only: `DTSTART;VALUE=DATE:20251215`
  - DateTime: `DTSTART:20251216T192000Z`
  
- **DTEND**: End date/time
  - Same format as DTSTART

- **DESCRIPTION**: Detailed event description
  - Can be multi-line (use `\n` for line breaks)
  - May contain HTML in `X-ALT-DESC;FMTTYPE=text/html`

- **URL**: Link to Canvas assignment
  - Example: `https://canvas.instructure.com/calendar?include_contexts=course_5223...`

- **CLASS**: Event classification
  - Usually `PUBLIC` for Canvas events

- **SEQUENCE**: Modification counter
  - Increments when event is updated

### Canvas-Specific Properties

- **X-ALT-DESC;FMTTYPE=text/html**: HTML version of description

## Date/Time Formats

### Date Only
```ical
DTSTART;VALUE=DATE:20251215
```
- Format: YYYYMMDD
- Represents: December 15, 2025

### DateTime (UTC)
```ical
DTSTART:20251216T192000Z
```
- Format: YYYYMMDDTHHMMSSz
- Represents: December 16, 2025 at 7:20 PM UTC
- 'Z' suffix indicates UTC

### DateTime (Local)
```ical
DTSTART:20251216T192000
```
- Same format but no 'Z' suffix
- Time in local timezone

## Text Encoding

Special characters must be escaped:

- **Newline**: `\n`
- **Comma**: `\,`
- **Semicolon**: `\;`
- **Backslash**: `\\`

Example:
```ical
DESCRIPTION:Line 1\nLine 2\, with comma
```

## Line Folding

Lines longer than 75 characters should be folded:

```ical
DESCRIPTION:This is a very long description that exceeds 75 characters and
  continues on the next line with a space at the start
```

Lines starting with space or tab are continuations.

## Canvas Assignment Format

### Typical Canvas Event

```ical
BEGIN:VEVENT
DTSTAMP:20251216T231700Z
UID:event-assignment-191379
DTSTART;VALUE=DATE:20251215
CLASS:PUBLIC
DESCRIPTION:Semester 1 Final Review\n------------------------\n\n* Use th
 e online textbook
SEQUENCE:0
SUMMARY:Sem 1 Review [p+ A.P. Statistics - 25-26/YR]
URL:https://moreau.instructure.com/calendar?include_contexts=course_5223
X-ALT-DESC;FMTTYPE=text/html:<h4>Semester 1 Final Review</h4>\n<ul>...
END:VEVENT
```

### Title Format Patterns

Canvas uses these patterns in SUMMARY:

1. **Regular assignment**: `Assignment Name [p Course Name]`
2. **Plus course**: `Assignment Name [p+ Course Name - YY-YY/TERM]`
3. **With period**: `Assignment Name (Period N) [p Course Name]`

Examples:
- `Practice #33 [p+ A.P. Statistics - 25-26/YR]`
- `Final Exam (Period 1) [p Spanish 3 - 25-26/YR]`
- `Unit 5 MCQ [p+ A.P. United States History - 25-26/YR]`

### Extracting Course Name

Regex pattern: `\[p\+?\s*(.+?)\s*(?:-\s*\d{2}-\d{2})?(?:\/[A-Z0-9]+)?\]`

Matches:
- `[p Course Name]` → `Course Name`
- `[p+ Course Name - 25-26/YR]` → `Course Name`
- `[p Course Name - 25-26/S2]` → `Course Name`

### Extracting Course ID

From URL: `course[s]?[_\/](\d+)`

Example:
- URL: `https://canvas.instructure.com/courses/5223/...`
- Course ID: `5223`

## Assignment Types

Detected from SUMMARY or DESCRIPTION:

| Keywords | Type |
|----------|------|
| exam, test, final | exam |
| quiz | quiz |
| discussion | discussion |
| (default) | assignment |

## Common Issues

### Line Folding
Lines may be split across multiple lines. Always check for continuation lines (starting with space).

### Encoding
- UTF-8 encoding is standard
- Special characters must be properly escaped
- Watch for HTML entities in descriptions

### Timezones
- Canvas typically uses UTC (`Z` suffix)
- All-day events use `VALUE=DATE` parameter
- Convert to local time as needed

### Duplicate Events
- Same UID = same event (update, not duplicate)
- Use UID as unique key in database
- SEQUENCE indicates version number

## Parsing Strategy

Our parser implementation:

1. Split on `BEGIN:VEVENT` to get individual events
2. Parse each event line by line
3. Handle line continuations
4. Decode escaped characters
5. Extract course info from SUMMARY
6. Parse dates based on format
7. Determine assignment type
8. Calculate status based on due date

## Testing

Use the attached `user_xxx.ics` file as a reference for:
- Real Canvas event structure
- Various assignment types
- Date format variations
- Course name patterns
- Description formats

## Resources

- [RFC 5545 - iCalendar Specification](https://tools.ietf.org/html/rfc5545)
- [iCalendar Validator](https://icalendar.org/validator.html)
- Canvas API Documentation
