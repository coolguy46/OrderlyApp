// Google Classroom Integration Service
// This module handles OAuth authentication and API calls to Google Classroom

export interface GoogleClassroomCourse {
  id: string;
  name: string;
  section?: string;
  descriptionHeading?: string;
  room?: string;
  ownerId: string;
  creationTime: string;
  updateTime: string;
  enrollmentCode?: string;
  courseState: 'ACTIVE' | 'ARCHIVED' | 'PROVISIONED' | 'DECLINED' | 'SUSPENDED';
  alternateLink: string;
}

export interface GoogleClassroomAssignment {
  id: string;
  courseId: string;
  title: string;
  description?: string;
  materials?: Array<{
    driveFile?: { id: string; title: string; alternateLink: string };
    youtubeVideo?: { id: string; title: string; alternateLink: string };
    link?: { url: string; title: string };
    form?: { formUrl: string; title: string };
  }>;
  state: 'PUBLISHED' | 'DRAFT' | 'DELETED';
  alternateLink: string;
  creationTime: string;
  updateTime: string;
  dueDate?: { year: number; month: number; day: number };
  dueTime?: { hours: number; minutes: number };
  maxPoints?: number;
  workType: 'ASSIGNMENT' | 'SHORT_ANSWER_QUESTION' | 'MULTIPLE_CHOICE_QUESTION';
}

export interface GoogleClassroomSubmission {
  courseId: string;
  courseWorkId: string;
  id: string;
  userId: string;
  creationTime: string;
  updateTime: string;
  state: 'NEW' | 'CREATED' | 'TURNED_IN' | 'RETURNED' | 'RECLAIMED_BY_STUDENT';
  late: boolean;
  assignedGrade?: number;
}

// Google OAuth Configuration
const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || '';
const GOOGLE_REDIRECT_URI = process.env.NEXT_PUBLIC_GOOGLE_REDIRECT_URI || '';
const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/classroom.courses.readonly',
  'https://www.googleapis.com/auth/classroom.coursework.me.readonly',
  'https://www.googleapis.com/auth/classroom.student-submissions.me.readonly',
].join(' ');

// Storage keys
const TOKEN_STORAGE_KEY = 'google_classroom_token';
const REFRESH_TOKEN_KEY = 'google_classroom_refresh_token';

export class GoogleClassroomService {
  private accessToken: string | null = null;
  private refreshToken: string | null = null;

  constructor() {
    if (typeof window !== 'undefined') {
      this.accessToken = localStorage.getItem(TOKEN_STORAGE_KEY);
      this.refreshToken = localStorage.getItem(REFRESH_TOKEN_KEY);
    }
  }

  // Check if user is connected to Google Classroom
  isConnected(): boolean {
    return !!this.accessToken;
  }

  // Get OAuth authorization URL
  getAuthUrl(): string {
    const params = new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      redirect_uri: GOOGLE_REDIRECT_URI,
      response_type: 'code',
      scope: GOOGLE_SCOPES,
      access_type: 'offline',
      prompt: 'consent',
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }

  // Exchange authorization code for tokens
  async exchangeCodeForTokens(code: string): Promise<boolean> {
    try {
      const response = await fetch('/api/auth/google-classroom/callback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });

      if (!response.ok) throw new Error('Failed to exchange code');

      const data = await response.json();
      this.accessToken = data.access_token;
      this.refreshToken = data.refresh_token;

      if (typeof window !== 'undefined') {
        localStorage.setItem(TOKEN_STORAGE_KEY, data.access_token);
        if (data.refresh_token) {
          localStorage.setItem(REFRESH_TOKEN_KEY, data.refresh_token);
        }
      }

      return true;
    } catch (error) {
      console.error('Error exchanging code for tokens:', error);
      return false;
    }
  }

  // Disconnect from Google Classroom
  disconnect(): void {
    this.accessToken = null;
    this.refreshToken = null;
    if (typeof window !== 'undefined') {
      localStorage.removeItem(TOKEN_STORAGE_KEY);
      localStorage.removeItem(REFRESH_TOKEN_KEY);
    }
  }

  // Make authenticated API request
  private async apiRequest<T>(endpoint: string): Promise<T | null> {
    if (!this.accessToken) {
      throw new Error('Not authenticated with Google Classroom');
    }

    try {
      const response = await fetch(`https://classroom.googleapis.com/v1/${endpoint}`, {
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
        },
      });

      if (response.status === 401) {
        // Token expired, try to refresh
        const refreshed = await this.refreshAccessToken();
        if (refreshed) {
          return this.apiRequest(endpoint);
        }
        throw new Error('Session expired');
      }

      if (!response.ok) {
        throw new Error(`API request failed: ${response.statusText}`);
      }

      return response.json();
    } catch (error) {
      console.error('Google Classroom API error:', error);
      return null;
    }
  }

  // Refresh access token
  private async refreshAccessToken(): Promise<boolean> {
    if (!this.refreshToken) return false;

    try {
      const response = await fetch('/api/auth/google-classroom/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: this.refreshToken }),
      });

      if (!response.ok) return false;

      const data = await response.json();
      this.accessToken = data.access_token;

      if (typeof window !== 'undefined') {
        localStorage.setItem(TOKEN_STORAGE_KEY, data.access_token);
      }

      return true;
    } catch {
      return false;
    }
  }

  // Get list of courses
  async getCourses(): Promise<GoogleClassroomCourse[]> {
    const response = await this.apiRequest<{ courses: GoogleClassroomCourse[] }>(
      'courses?courseStates=ACTIVE'
    );
    return response?.courses || [];
  }

  // Get assignments for a course
  async getCourseWork(courseId: string): Promise<GoogleClassroomAssignment[]> {
    const response = await this.apiRequest<{ courseWork: GoogleClassroomAssignment[] }>(
      `courses/${courseId}/courseWork`
    );
    return response?.courseWork || [];
  }

  // Get all assignments across all courses
  async getAllAssignments(): Promise<Array<GoogleClassroomAssignment & { courseName: string }>> {
    const courses = await this.getCourses();
    const allAssignments: Array<GoogleClassroomAssignment & { courseName: string }> = [];

    for (const course of courses) {
      const assignments = await this.getCourseWork(course.id);
      for (const assignment of assignments) {
        allAssignments.push({
          ...assignment,
          courseName: course.name,
        });
      }
    }

    // Sort by due date
    return allAssignments.sort((a, b) => {
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      const dateA = new Date(a.dueDate.year, a.dueDate.month - 1, a.dueDate.day);
      const dateB = new Date(b.dueDate.year, b.dueDate.month - 1, b.dueDate.day);
      return dateA.getTime() - dateB.getTime();
    });
  }

  // Get submission status for an assignment
  async getSubmissionStatus(
    courseId: string,
    courseWorkId: string
  ): Promise<GoogleClassroomSubmission | null> {
    const response = await this.apiRequest<{ studentSubmissions: GoogleClassroomSubmission[] }>(
      `courses/${courseId}/courseWork/${courseWorkId}/studentSubmissions`
    );
    return response?.studentSubmissions?.[0] || null;
  }

  // Convert Google Classroom assignment to app task format
  convertToTask(assignment: GoogleClassroomAssignment & { courseName: string }) {
    let dueDate: string | undefined;
    if (assignment.dueDate) {
      const { year, month, day } = assignment.dueDate;
      const hours = assignment.dueTime?.hours || 23;
      const minutes = assignment.dueTime?.minutes || 59;
      dueDate = new Date(year, month - 1, day, hours, minutes).toISOString();
    }

    return {
      title: assignment.title,
      description: assignment.description || `From Google Classroom: ${assignment.courseName}`,
      priority: 'medium' as const,
      status: 'pending' as const,
      due_date: dueDate,
      source: 'google_classroom' as const,
      external_id: `gc_${assignment.courseId}_${assignment.id}`,
      external_url: assignment.alternateLink,
      course_name: assignment.courseName,
    };
  }
}

// Singleton instance
export const googleClassroom = new GoogleClassroomService();
