import { BrowserRouter, Routes, Route } from 'react-router-dom'
import SidebarShell from '@/components/SidebarShell'
import SidebarStatus from '@/components/SidebarStatus'
import TwemojiLoader from '@/components/TwemojiLoader'

import HomePage from '@/pages/HomePage'
import ProxiesPage from '@/pages/ProxiesPage'
import SubscriptionsPage from '@/pages/SubscriptionsPage'
import RulesPage from '@/pages/RulesPage'
import GroupsPage from '@/pages/GroupsPage'
import ConnectionsPage from '@/pages/ConnectionsPage'
import LogsPage from '@/pages/LogsPage'
import SettingsPage from '@/pages/SettingsPage'
import ConfigPage from '@/pages/ConfigPage'
import GroupRulesPage from '@/pages/GroupRulesPage'

export default function App() {
  return (
    <BrowserRouter>
      <SidebarStatus />
      <TwemojiLoader />
      <SidebarShell>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/proxies" element={<ProxiesPage />} />
          <Route path="/subscriptions" element={<SubscriptionsPage />} />
          <Route path="/rules" element={<RulesPage />} />
          <Route path="/groups" element={<GroupsPage />} />
          <Route path="/connections" element={<ConnectionsPage />} />
          <Route path="/logs" element={<LogsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/config" element={<ConfigPage />} />
          <Route path="/group-rules" element={<GroupRulesPage />} />
        </Routes>
      </SidebarShell>
    </BrowserRouter>
  )
}
