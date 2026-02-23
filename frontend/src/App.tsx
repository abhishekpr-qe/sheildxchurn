import { useEffect } from 'react'
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import { DashboardDataContext, useDashboardDataProvider } from './hooks/useDashboardData'
import { DrawerContext, useDrawerProvider } from './hooks/useDrawer'
import { DashboardLayout } from './layouts/DashboardLayout'
import { WarRoom } from './pages/WarRoom/WarRoom'
import { RiskExplorer } from './pages/RiskExplorer/RiskExplorer'
import { Simulator } from './pages/Simulator/Simulator'
import { CommandCenter } from './pages/CommandCenter/CommandCenter'

export default function App() {
  const dashboard = useDashboardDataProvider()
  const drawer = useDrawerProvider()

  useEffect(() => {
    dashboard.fetchAll()
  }, [])

  return (
    <DashboardDataContext.Provider value={dashboard}>
      <DrawerContext.Provider value={drawer}>
        <HashRouter>
          <Routes>
            <Route element={<DashboardLayout />}>
              <Route path="/warroom" element={<WarRoom />} />
              <Route path="/explorer" element={<RiskExplorer />} />
              <Route path="/simulator" element={<Simulator />} />
              <Route path="/command" element={<CommandCenter />} />
              <Route path="*" element={<Navigate to="/warroom" replace />} />
            </Route>
          </Routes>
        </HashRouter>
      </DrawerContext.Provider>
    </DashboardDataContext.Provider>
  )
}
