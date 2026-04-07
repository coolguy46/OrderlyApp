// Desktop notification utilities for Orderly

export function requestNotificationPermission(): Promise<NotificationPermission> {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return Promise.resolve('denied');
  }
  if (Notification.permission === 'granted') {
    return Promise.resolve('granted');
  }
  return Notification.requestPermission();
}

export function sendDesktopNotification(
  title: string,
  options?: {
    body?: string;
    icon?: string;
    badge?: string;
    tag?: string;
    requireInteraction?: boolean;
  }
): Notification | null {
  if (typeof window === 'undefined' || !('Notification' in window)) return null;
  if (Notification.permission !== 'granted') return null;

  try {
    const notif = new Notification(title, {
      body: options?.body,
      icon: options?.icon || '/logo.svg',
      badge: options?.badge || '/logo.svg',
      tag: options?.tag,
      requireInteraction: options?.requireInteraction || false,
    });
    return notif;
  } catch (e) {
    console.warn('Notification failed:', e);
    return null;
  }
}

export async function scheduleTaskReminder(
  taskTitle: string,
  dueDate: Date,
  minutesBefore = 30
): Promise<void> {
  const permission = await requestNotificationPermission();
  if (permission !== 'granted') return;

  const now = Date.now();
  const notifyAt = dueDate.getTime() - minutesBefore * 60 * 1000;
  const delay = notifyAt - now;

  if (delay > 0) {
    setTimeout(() => {
      sendDesktopNotification(`⏰ Task due in ${minutesBefore} minutes`, {
        body: taskTitle,
        tag: `task-reminder-${taskTitle}`,
        requireInteraction: true,
      });
    }, delay);
  }
}
