import { Outlet } from 'react-router-dom'
import { Header } from './Header'
import { TabBar } from './TabBar'
import { User360Drawer } from '../drawers/User360Drawer'
import { Toast } from '../components/ui/Toast'

export function DashboardLayout() {
  return (
    <div className="min-h-screen bg-surface-0 text-text-primary">
      <Header />
      <TabBar />
      <main className="px-8 py-5 pb-12 animate-fade-in">
        <Outlet />
      </main>
      <User360Drawer />
      <Toast />
    </div>
  )
}
