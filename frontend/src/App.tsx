import { Link, Route, Routes } from 'react-router-dom'
import { Shell } from './components/Shell'
import { Analysis } from './pages/Analysis'
import { History } from './pages/History'
import { Method } from './pages/Method'
import { NewAnalysis } from './pages/NewAnalysis'
import { Overview } from './pages/Overview'
import { Report } from './pages/Report'
import { ErrorPanel } from './components/ui'

export default function App() {
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={<Overview />} />
        <Route path="new" element={<NewAnalysis />} />
        <Route path="analysis/:jobId" element={<Analysis />} />
        <Route path="report/:sha" element={<Report />} />
        <Route path="history" element={<History />} />
        <Route path="method" element={<Method />} />
        <Route
          path="*"
          element={
            <ErrorPanel message="This page does not exist.">
              <Link to="/" className="btn-primary">Go to overview</Link>
            </ErrorPanel>
          }
        />
      </Route>
    </Routes>
  )
}
