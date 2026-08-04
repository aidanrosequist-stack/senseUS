import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import { useState, useEffect, useRef } from 'react'

export function useNotifications() {
  const { user } = useAuth()
  const [notifications, setNotifications] = useState([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [urgentNotification, setUrgentNotification] = useState(null)
  const [highNotifications, setHighNotifications] = useState([])
  const [loading, setLoading] = useState(true)

  const channelRef = useRef(null)

  /* eslint-disable react-hooks/set-state-in-effect -- async notification fetch plus a live realtime subscription; both inherently depend on data that doesn't exist until after render */
  useEffect(() => {
    if (!user) {
      setLoading(false)
      return
    }

    async function fetchNotifications() {
      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(50)

      if (!error && data) {
        setNotifications(data)
        setUnreadCount(data.filter(n => !n.read).length)
        const urgent = data.find(n => !n.read && n.priority === 'urgent')
        setUrgentNotification(urgent || null)
        const high = data.filter(n => !n.read && n.priority === 'high')
        setHighNotifications(high)
      }
      setLoading(false)
    }

    fetchNotifications()

    // Clean up any existing channel first
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current)
    }

    channelRef.current = supabase
      .channel(`notifications-${user.id}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'notifications',
        filter: `user_id=eq.${user.id}`,
      }, (payload) => {
        setNotifications(prev => [payload.new, ...prev])
        if (!payload.new.read) {
          setUnreadCount(prev => prev + 1)
          if (payload.new.priority === 'urgent') {
            setUrgentNotification(payload.new)
          } else if (payload.new.priority === 'high') {
            setHighNotifications(prev => [...prev, payload.new])
          }
        }
      })
      .subscribe()

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current)
        channelRef.current = null
      }
    }
  }, [user])
  /* eslint-enable react-hooks/set-state-in-effect */

  async function markAsRead(notificationId) {
    await supabase
      .from('notifications')
      .update({ read: true })
      .eq('id', notificationId)

    setNotifications(prev =>
      prev.map(n => n.id === notificationId ? { ...n, read: true } : n)
    )
    setUnreadCount(prev => Math.max(0, prev - 1))
  }

  async function markAllAsRead() {
    await supabase
      .from('notifications')
      .update({ read: true })
      .eq('user_id', user.id)
      .eq('read', false)

    setNotifications(prev => prev.map(n => ({ ...n, read: true })))
    setUnreadCount(0)
    setUrgentNotification(null)
    setHighNotifications([])
  }

  async function dismissUrgent(notificationId) {
    await markAsRead(notificationId)
    setUrgentNotification(null)
  }

  async function dismissHigh(notificationId) {
    await markAsRead(notificationId)
    setHighNotifications(prev => prev.filter(n => n.id !== notificationId))
  }

  return {
    notifications,
    unreadCount,
    urgentNotification,
    highNotifications,
    loading,
    markAsRead,
    markAllAsRead,
    dismissUrgent,
    dismissHigh,
  }
}