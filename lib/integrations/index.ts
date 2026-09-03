// Integration Services Index
// Export all integration utilities from this module

// Canvas Integration
export {
  parseICalFile,
  fetchICalFromUrl,
  syncCanvasCalendar,
  filterAssignmentsByDateRange,
  groupAssignmentsByCourse,
  sortAssignmentsByDueDate,
  getUpcomingAssignments,
  getOverdueAssignments,
} from './canvas';
export type { CanvasAssignment } from './canvas';
