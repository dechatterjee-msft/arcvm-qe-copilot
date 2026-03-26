import { Routes, Route, Navigate } from 'react-router-dom';
import LandingPage from './pages/LandingPage';
import PlannerLayout from './pages/PlannerLayout';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/planner" element={<PlannerLayout />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
