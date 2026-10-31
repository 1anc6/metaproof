import { lazy } from 'react'
import { Link, Route, Routes } from 'react-router-dom'
import { Shell } from './components/Shell'
import { Overview } from './pages/Overview'
import { ErrorPanel } from './components/ui'
import { DevDataToggle } from './components/DevDataToggle'

// The overview is the usual first screen, so it ships with the app; every other page loads its
// own code when it is first opened (Shell shows an orb meanwhile).
const NewAnalysis = lazy(() => import('./pages/NewAnalysis').then((m) => ({ default: m.NewAnalysis })))
const Analysis = lazy(() => import('./pages/Analysis').then((m) => ({ default: m.Analysis })))
const Report = lazy(() => import('./pages/Report').then((m) => ({ default: m.Report })))
const History = lazy(() => import('./pages/History').then((m) => ({ default: m.History })))
const Method = lazy(() => import('./pages/Method').then((m) => ({ default: m.Method })))
const Settings = lazy(() => import('./pages/Settings').then((m) => ({ default: m.Settings })))

export default function App() {
  return (
    <>
    <Routes>
      <Route element={<Shell />}>
        <Route index element={<Overview />} />
        <Route path="new" element={<NewAnalysis />} />
        <Route path="analysis/:jobId" element={<Analysis />} />
        <Route path="report/:sha" element={<Report />} />
        <Route path="history" element={<History />} />
        <Route path="method" element={<Method />} />
        <Route path="settings" element={<Settings />} />
        <Route
          path="*"
          element={
            <ErrorPanel label="404" title="Page not found" message="There is nothing at this address.">
              <Link to="/" className="btn-primary">Go to overview</Link>
            </ErrorPanel>
          }
        />
      </Route>
    </Routes>
    {import.meta.env.DEV && <DevDataToggle />}
    </>
  )
}
