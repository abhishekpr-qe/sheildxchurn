import { createContext, useContext, useState, useCallback } from 'react'
import type { User } from '../types'

interface DrawerState {
  isOpen: boolean
  selectedUser: User | null
  openDrawer: (user: User) => void
  closeDrawer: () => void
}

const defaultState: DrawerState = {
  isOpen: false,
  selectedUser: null,
  openDrawer: () => {},
  closeDrawer: () => {},
}

export const DrawerContext = createContext<DrawerState>(defaultState)

export function useDrawer() {
  return useContext(DrawerContext)
}

export function useDrawerProvider() {
  const [isOpen, setIsOpen] = useState(false)
  const [selectedUser, setSelectedUser] = useState<User | null>(null)

  const openDrawer = useCallback((user: User) => {
    setSelectedUser(user)
    setIsOpen(true)
  }, [])

  const closeDrawer = useCallback(() => {
    setIsOpen(false)
    setTimeout(() => setSelectedUser(null), 300)
  }, [])

  return { isOpen, selectedUser, openDrawer, closeDrawer }
}
