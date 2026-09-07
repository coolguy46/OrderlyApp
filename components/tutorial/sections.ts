export interface TutorialSection {
  id: string;
  label: string;
  title: string;
  description: string;
  steps: string[];
  takeaway: string;
  image: string;
  imageAlt: string;
  href: string;
  destination: string;
}

// UI instructions, not planner prompts. Regenerate the demo captures when controls change.
export const TUTORIAL_SECTIONS: readonly TutorialSection[] = [
  {
    id: 'dashboard', label: 'Your day', title: 'Start with what matters today',
    description: 'The Dashboard brings today’s work, your progress, and your calendar together.',
    steps: [
      'Today’s Tasks shows work for this day. Canvas assignments due during tomorrow’s school hours can appear today so you can prepare ahead.',
      'A task that becomes overdue today stays here until the day ends. Older unfinished work is in Tasks → Missing; click the Dashboard’s Missing card to get there.',
      'Choose a date in the small calendar to see that day, or switch Your day to Schedule to see planned work. Back to Today returns to the current day.',
    ],
    takeaway: 'A red calendar date means at least one unfinished assignment on that date is overdue—not that every task is missing.',
    image: 'dashboard', imageAlt: 'Alex Morgan’s demo dashboard with Biology Worksheet and Math Practice, a Missing statistic, and the September calendar.', href: '/', destination: 'Dashboard',
  },
  {
    id: 'tasks', label: 'Find your tasks', title: 'Everything you need to finish',
    description: 'Tasks are assignments and to-dos you can check off. Keep them separate from places you need to be.',
    steps: [
      'Use All, Active, Missing, and Done to find your work. Missing holds unfinished tasks whose deadline was on an earlier day.',
      'Search by title and use the filter control to narrow the list. Select a task to inspect it; use its edit control to change details.',
      'Click a task’s completion circle when you finish it. It moves to Done. Check the saved result before leaving the page.',
    ],
    takeaway: 'In this demo, English Essay Draft is missing, Biology Worksheet is still pending, and Math Practice is done.',
    image: 'tasks', imageAlt: 'The Tasks view with fictional Biology, English, and Math assignments and All, Active, Missing, and Done filters.', href: '/tasks', destination: 'Tasks',
  },
  {
    id: 'task-editor', label: 'Create & edit tasks', title: 'A deadline is not a work session',
    description: 'Give a task a due date, then choose when you want to work on it—those are separate decisions.',
    steps: [
      'Choose New Task. Enter a title, subject, priority, and due date or time. Add description opens space for notes.',
      'In Schedule, choose a schedule date, start time, and duration. Leave the start time blank to keep the task untimed.',
      'Use Repeat for recurring work and choose weekdays when using a weekly repeat. Save with Create Task or Update Task.',
    ],
    takeaway: 'You can schedule an overdue Canvas assignment for this week without changing the deadline imported from Canvas.',
    image: 'task-editor', imageAlt: 'The task editor showing Biology Worksheet, its deadline fields, and separate Schedule date, start time, and duration controls.', href: '/tasks', destination: 'Tasks',
  },
  {
    id: 'event-editor', label: 'Events & repeats', title: 'Make room for life, too',
    description: 'Classes, games, practices, and meetings are events—not assignments to check off.',
    steps: [
      'Open the creation window and choose the Event tab. Add a title, event date, start and end times, and an optional location.',
      'Leave the weekday buttons unselected for a one-time event. Select days to repeat weekly; Repeat until can limit the series.',
      'Choose Create Event. Click an event on the calendar to edit it. For recurring events, check whether you’re changing one occurrence or the whole series.',
    ],
    takeaway: 'Soccer Practice is a repeating event. Counselor Meeting is a one-time event. Neither needs a task completion checkbox.',
    image: 'event-editor', imageAlt: 'The Event editor with Soccer Practice, start and end times, and horizontal weekday repeat controls.', href: '/calendar', destination: 'Calendar',
  },
  {
    id: 'calendar', label: 'Calendar', title: 'Look beyond this week',
    description: 'Task Calendar gives you the big picture. Browse dates without changing anything in your plan.',
    steps: [
      'Open Calendar and choose Task Calendar. Switch between Month and Week to change the level of detail.',
      'Use the arrows to browse earlier or later dates. Today takes you back to the current date.',
      'Select a task or event to open its editor. Use New to create an item, and check the selected date in the form.',
    ],
    takeaway: 'You are not limited to the next seven days. The arrows let you browse future weeks and months.',
    image: 'calendar', imageAlt: 'The September 2026 Task Calendar with demo tasks and events, date navigation, and Month and Week controls.', href: '/calendar', destination: 'Calendar',
  },
  {
    id: 'schedule', label: 'Schedule', title: 'Turn your task list into a plan',
    description: 'The Schedule view shows when you’ll do the work, alongside your events and availability.',
    steps: [
      'Choose Schedule. Click empty space in the time grid to create a task or event at that date and time; check the prefilled fields before saving.',
      'Drag untimed tasks into a time slot. Move a block to change its time, or use its resize control to adjust the session length.',
      'Click an existing block to edit it. Schedule tips explains the controls. On a phone, scroll inside the grid to reach other days and times.',
    ],
    takeaway: 'Moving planned work changes when you’ll do it. It does not move the assignment’s deadline.',
    image: 'schedule', imageAlt: 'The weekly Schedule with fictional study blocks, Soccer Practice, an untimed shelf, and Schedule tips.', href: '/calendar', destination: 'Calendar',
  },
  {
    id: 'assistant', label: 'Assistant', title: 'Talk through your plan',
    description: 'Ask about your work or tell Orderly what to create, move, repeat, or remove.',
    steps: [
      'Describe the result you want in your own words. For example: “Plan my unfinished work this week, but keep Monday light.”',
      'Include important details such as availability or how long an activity should take. You can follow up to clarify or correct the request.',
      'Read the result and check Your calendar. Saved changes appear there; if something fails or needs clarification, don’t assume it was saved. Use Undo when available.',
    ],
    takeaway: 'The Assistant can make mistakes. Check dates, AM/PM, task versus event, repeat rules, and the actual calendar result.',
    image: 'assistant', imageAlt: 'The Orderly Assistant interface with its conversation area, message field, and browsable demo calendar.', href: '/planner', destination: 'Assistant',
  },
  {
    id: 'goals', label: 'Goals', title: 'Track a bigger finish line',
    description: 'Use Goals for outcomes that take more than a single task.',
    steps: [
      'Choose Add Goal and enter a title, target, unit, and optional deadline.',
      'Record progress as you work. The progress indicator compares your current value with your target.',
      'Use the goal’s edit control to update its details or progress. Completing a task does not replace checking your goal’s own progress.',
    ],
    takeaway: 'Alex’s goal is Finish the Essay Outline. Small completed steps make progress visible.',
    image: 'goals', imageAlt: 'The Goals page showing the fictional Finish the Essay Outline goal and its progress.', href: '/goals', destination: 'Goals',
  },
  {
    id: 'study', label: 'Study', title: 'Give one thing your attention',
    description: 'Use a focused timer or track an open-ended study session.',
    steps: [
      'Open Study. Choose Pomodoro for focus and break intervals, or Stopwatch to count up.',
      'Choose a subject in Studying for, then use Start and Pause. Reset ends the timer early; elapsed focus or stopwatch time of at least one minute is saved as a study session.',
      'Review your study progress and adjust the study goal or timer settings to suit your routine.',
    ],
    takeaway: 'A study session tracks time. Remember to mark the assignment complete when the work itself is finished.',
    image: 'study', imageAlt: 'The Study page and Pomodoro timer using Alex Morgan’s fictional Biology, English, and Math subjects.', href: '/study', destination: 'Study',
  },
  {
    id: 'exams', label: 'Exams', title: 'Prepare before the countdown runs out',
    description: 'Keep exam details and preparation progress together.',
    steps: [
      'Choose Add Exam and enter the title, subject, date, time, and location as needed.',
      'Review upcoming exams and update preparation progress as you study.',
      'Use tasks for specific revision work and schedule those sessions separately from the exam itself.',
    ],
    takeaway: 'Biology Quiz is the exam. Biology Worksheet is work Alex can schedule to prepare.',
    image: 'exams', imageAlt: 'The Exams page displaying the fictional Biology Quiz with its date and preparation progress.', href: '/exams', destination: 'Exams',
  },
  {
    id: 'settings', label: 'Settings & profile', title: 'Make Orderly fit your routine',
    description: 'Preferences, availability, account controls, and integrations live here.',
    steps: [
      'In Settings, choose Light, Dark, or System appearance. Check school days, availability, and Notifications preferences to fit your routine.',
      'Use Account to update your name and Privacy & Security for account controls or Export Data. Read warnings carefully before destructive actions.',
      'The profile menu opens Profile, Settings, and Sign out. Search in the header finds tasks, goals, and exams. On mobile, More opens the remaining navigation sections.',
    ],
    takeaway: 'The question mark beside your profile reopens this guide anytime. Next, connect Canvas to bring in assignments.',
    image: 'settings', imageAlt: 'Settings with theme choices and the Integrations entry, shown with fictional demo account data.', href: '/settings', destination: 'Settings',
  },
  {
    id: 'canvas', label: 'Connect Canvas', title: 'Bring your assignments into Orderly',
    description: 'Finish by connecting your Canvas Calendar Feed. You can also reopen these instructions in Integrations.',
    steps: [], takeaway: 'Your feed link is private. The tutorial never needs your Canvas password or your real feed URL.',
    image: 'canvas-integration', imageAlt: 'Orderly Integrations with the Calendar feed URL field and Connect Canvas button; no private feed link is shown.', href: '/settings/integrations', destination: 'Integrations',
  },
];
