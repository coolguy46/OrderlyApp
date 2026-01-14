/**
 * Canvas Integration Examples
 * 
 * This file demonstrates how to use the Canvas integration utility functions.
 * You can run these examples in your development environment to test the integration.
 */

import {
  syncCanvasCalendar,
  parseICalFile,
  filterAssignmentsByDateRange,
  groupAssignmentsByCourse,
  sortAssignmentsByDueDate,
  getUpcomingAssignments,
  getOverdueAssignments,
  CanvasAssignment,
} from '@/lib/integrations/canvas';

// Example 1: Basic sync from URL
async function exampleBasicSync() {
  console.log('Example 1: Basic Sync');
  console.log('--------------------');
  
  const icalUrl = 'https://canvas.instructure.com/feeds/calendars/user_xxx.ics';
  
  try {
    const assignments = await syncCanvasCalendar(icalUrl);
    console.log(`✓ Found ${assignments.length} assignments`);
    
    // Show first assignment
    if (assignments.length > 0) {
      const first = assignments[0];
      console.log('\nFirst assignment:');
      console.log(`  Title: ${first.title}`);
      console.log(`  Course: ${first.courseName}`);
      console.log(`  Type: ${first.type}`);
      console.log(`  Due: ${first.dueDate?.toLocaleDateString()}`);
      console.log(`  Status: ${first.status}`);
    }
  } catch (error) {
    console.error('✗ Error:', error);
  }
}

// Example 2: Parse local iCal file
function exampleParseLocal() {
  console.log('\nExample 2: Parse Local iCal');
  console.log('---------------------------');
  
  // Sample iCal content
  const icalContent = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:event-assignment-1
DTSTART;VALUE=DATE:20260115
SUMMARY:Math Homework [p Math 101 - 25-26]
DESCRIPTION:Complete problems 1-20
URL:https://canvas.instructure.com/courses/123
END:VEVENT
END:VCALENDAR`;

  const assignments = parseICalFile(icalContent);
  console.log(`✓ Parsed ${assignments.length} assignments`);
  
  if (assignments.length > 0) {
    assignments.forEach(a => {
      console.log(`  - ${a.title} (${a.courseName})`);
    });
  }
}

// Example 3: Filter by date range
async function exampleDateFilter() {
  console.log('\nExample 3: Filter by Date Range');
  console.log('-------------------------------');
  
  const icalUrl = 'https://canvas.instructure.com/feeds/calendars/user_xxx.ics';
  
  try {
    const allAssignments = await syncCanvasCalendar(icalUrl);
    
    // Get assignments for January 2026
    const startDate = new Date('2026-01-01');
    const endDate = new Date('2026-01-31');
    
    const januaryAssignments = filterAssignmentsByDateRange(
      allAssignments,
      startDate,
      endDate
    );
    
    console.log(`✓ Found ${januaryAssignments.length} assignments in January 2026`);
  } catch (error) {
    console.error('✗ Error:', error);
  }
}

// Example 4: Group by course
async function exampleGroupByCourse() {
  console.log('\nExample 4: Group by Course');
  console.log('-------------------------');
  
  const icalUrl = 'https://canvas.instructure.com/feeds/calendars/user_xxx.ics';
  
  try {
    const assignments = await syncCanvasCalendar(icalUrl);
    const grouped = groupAssignmentsByCourse(assignments);
    
    console.log(`✓ Found assignments in ${Object.keys(grouped).length} courses:\n`);
    
    for (const [courseName, courseAssignments] of Object.entries(grouped)) {
      console.log(`  ${courseName}:`);
      console.log(`    - ${courseAssignments.length} assignments`);
      
      // Show assignment types breakdown
      const types = courseAssignments.reduce((acc, a) => {
        acc[a.type] = (acc[a.type] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);
      
      for (const [type, count] of Object.entries(types)) {
        console.log(`    - ${count} ${type}(s)`);
      }
      console.log('');
    }
  } catch (error) {
    console.error('✗ Error:', error);
  }
}

// Example 5: Get upcoming assignments (next 7 days)
async function exampleUpcoming() {
  console.log('\nExample 5: Upcoming Assignments');
  console.log('------------------------------');
  
  const icalUrl = 'https://canvas.instructure.com/feeds/calendars/user_xxx.ics';
  
  try {
    const assignments = await syncCanvasCalendar(icalUrl);
    const upcoming = getUpcomingAssignments(assignments);
    
    console.log(`✓ ${upcoming.length} assignments due in the next 7 days:\n`);
    
    // Sort by due date
    const sorted = sortAssignmentsByDueDate(upcoming);
    
    sorted.forEach(assignment => {
      const daysUntil = assignment.dueDate 
        ? Math.ceil((assignment.dueDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
        : 0;
      
      console.log(`  ${assignment.title}`);
      console.log(`    Course: ${assignment.courseName}`);
      console.log(`    Due: ${assignment.dueDate?.toLocaleDateString()} (in ${daysUntil} days)`);
      console.log(`    Type: ${assignment.type}`);
      console.log('');
    });
  } catch (error) {
    console.error('✗ Error:', error);
  }
}

// Example 6: Get overdue assignments
async function exampleOverdue() {
  console.log('\nExample 6: Overdue Assignments');
  console.log('-----------------------------');
  
  const icalUrl = 'https://canvas.instructure.com/feeds/calendars/user_xxx.ics';
  
  try {
    const assignments = await syncCanvasCalendar(icalUrl);
    const overdue = getOverdueAssignments(assignments);
    
    if (overdue.length === 0) {
      console.log('✓ No overdue assignments - great job!');
    } else {
      console.log(`⚠ ${overdue.length} overdue assignments:\n`);
      
      overdue.forEach(assignment => {
        const daysLate = assignment.dueDate
          ? Math.ceil((Date.now() - assignment.dueDate.getTime()) / (1000 * 60 * 60 * 24))
          : 0;
        
        console.log(`  ${assignment.title}`);
        console.log(`    Course: ${assignment.courseName}`);
        console.log(`    Was due: ${assignment.dueDate?.toLocaleDateString()} (${daysLate} days ago)`);
        console.log('');
      });
    }
  } catch (error) {
    console.error('✗ Error:', error);
  }
}

// Example 7: Statistics summary
async function exampleStatistics() {
  console.log('\nExample 7: Assignment Statistics');
  console.log('-------------------------------');
  
  const icalUrl = 'https://canvas.instructure.com/feeds/calendars/user_xxx.ics';
  
  try {
    const assignments = await syncCanvasCalendar(icalUrl);
    
    // Calculate statistics
    const stats = {
      total: assignments.length,
      byType: assignments.reduce((acc, a) => {
        acc[a.type] = (acc[a.type] || 0) + 1;
        return acc;
      }, {} as Record<string, number>),
      byStatus: assignments.reduce((acc, a) => {
        acc[a.status] = (acc[a.status] || 0) + 1;
        return acc;
      }, {} as Record<string, number>),
      courses: new Set(assignments.map(a => a.courseName)).size,
      upcoming: getUpcomingAssignments(assignments).length,
      overdue: getOverdueAssignments(assignments).length,
    };
    
    console.log('✓ Assignment Statistics:\n');
    console.log(`  Total Assignments: ${stats.total}`);
    console.log(`  Courses: ${stats.courses}`);
    console.log(`  Upcoming (7 days): ${stats.upcoming}`);
    console.log(`  Overdue: ${stats.overdue}`);
    console.log('\n  By Type:');
    Object.entries(stats.byType).forEach(([type, count]) => {
      console.log(`    - ${type}: ${count}`);
    });
    console.log('\n  By Status:');
    Object.entries(stats.byStatus).forEach(([status, count]) => {
      console.log(`    - ${status}: ${count}`);
    });
  } catch (error) {
    console.error('✗ Error:', error);
  }
}

// Run all examples (for testing purposes)
export async function runAllExamples() {
  console.log('='.repeat(50));
  console.log('Canvas Integration Examples');
  console.log('='.repeat(50));
  
  // Note: Replace the URL with your actual Canvas calendar URL
  const YOUR_CANVAS_URL = process.env.CANVAS_ICAL_URL || 'https://canvas.instructure.com/feeds/calendars/user_xxx.ics';
  
  console.log(`\nUsing URL: ${YOUR_CANVAS_URL}`);
  console.log('\n');
  
  await exampleBasicSync();
  exampleParseLocal();
  await exampleDateFilter();
  await exampleGroupByCourse();
  await exampleUpcoming();
  await exampleOverdue();
  await exampleStatistics();
  
  console.log('\n' + '='.repeat(50));
  console.log('Examples completed!');
  console.log('='.repeat(50));
}

// Export examples for individual testing
export {
  exampleBasicSync,
  exampleParseLocal,
  exampleDateFilter,
  exampleGroupByCourse,
  exampleUpcoming,
  exampleOverdue,
  exampleStatistics,
};

// Uncomment to run when executing this file directly
// runAllExamples().catch(console.error);
