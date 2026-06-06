import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { HomePage } from './pages/HomePage'
import { ModulesPage } from './pages/ModulesPage'
import { PricingPage } from './pages/PricingPage'
import { LoginPage } from './pages/LoginPage'
import { SignupPage } from './pages/SignupPage'
import { FeaturesPage } from './pages/FeaturesPage'

import { AboutPage } from './pages/AboutPage'
import { IndustriesPage } from './pages/IndustriesPage'
import { StartFreeTrialPage } from './pages/StartFreeTrialPage'
import { WorkspacesPage } from './pages/WorkspacesPage'
import { WorkspaceLayout } from './components/WorkspaceLayout'
import { DashboardPage } from './pages/DashboardPage'
import { MarketplacePage } from './pages/MarketplacePage'
import { EditWorkspacePage } from './pages/EditWorkspacePage'
import { ScrollToTop } from './components/ScrollToTop'

function PageTransition({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25, ease: 'easeInOut' }}
    >
      {children}
    </motion.div>
  )
}

function AnimatedRoutes() {
  const location = useLocation()
  return (
    <AnimatePresence mode="wait">
      <Routes location={location} key={location.pathname}>
        <Route path="/"                  element={<PageTransition><HomePage /></PageTransition>} />
        <Route path="/modules"           element={<PageTransition><ModulesPage /></PageTransition>} />
        <Route path="/pricing"           element={<PageTransition><PricingPage /></PageTransition>} />
        <Route path="/features"          element={<PageTransition><FeaturesPage /></PageTransition>} />
        <Route path="/about"             element={<PageTransition><AboutPage /></PageTransition>} />
        <Route path="/industries"        element={<PageTransition><IndustriesPage /></PageTransition>} />
        <Route path="/start-free-trial"  element={<PageTransition><StartFreeTrialPage /></PageTransition>} />
        <Route path="/login"             element={<PageTransition><LoginPage /></PageTransition>} />
        <Route path="/signup"            element={<PageTransition><SignupPage /></PageTransition>} />

        {/* Account & Workspace Routes */}
        <Route path="/workspaces"        element={<PageTransition><WorkspacesPage /></PageTransition>} />
        <Route path="/edit-workspace"    element={<PageTransition><EditWorkspacePage /></PageTransition>} />


      </Routes>
    </AnimatePresence>
  )
}

function App() {
  return (
    <BrowserRouter>
      <ScrollToTop />
      <AnimatedRoutes />
    </BrowserRouter>
  )
}

export default App
