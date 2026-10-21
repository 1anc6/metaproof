import { Link, Route, Routes } from 'react-router-dom'
import { Shell } from './components/Shell'
import { Analysis } from './pages/Analysis'
import { History } from './pages/History'
import { Method } from './pages/Method'
import { NewAnalysis } from './pages/NewAnalysis'
import { Overview } from './pages/Overview'
import { Report } from './pages/Report'
import { Settings } from './pages/Settings'
import { ErrorPanel } from './components/ui'
import { DevDataToggle } from './components/DevDataToggle'

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
