import { createContext, useContext } from 'react'

export const NotificationsContext = createContext({
  notifications: [],
  unreadCount: 0,
  urgentNotification: null,
  highNotifications: [],
  markAsRead: () => {},
  markAllAsRead: () => {},
  dismissUrgent: () => {},
  dismissHigh: () => {},
})

export function useNotificationsContext() {
  return useContext(NotificationsContext)
}