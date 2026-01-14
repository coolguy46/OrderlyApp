// Integration Services Index
// Export all integration utilities from this module

// Google Classroom Integration
export { googleClassroom } from './google-classroom';
export type { 
  GoogleClassroomCourse, 
  GoogleClassroomAssignment, 
  GoogleClassroomSubmission 
} from './google-classroom';

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

// Canvas Live Sync Hook
export { 
  useCanvasSync, 
  formatTimeUntilSync, 
  formatLastSync 
} from './useCanvasSync';
