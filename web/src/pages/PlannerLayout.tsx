import { useState } from 'react';
import { Pencil, Play } from 'lucide-react';
import PlannerView from './PlannerView';
import RunsView from './RunsView';

type View = 'planner' | 'runs';

export default function PlannerLayout() {
  const [view, setView] = useState<View>('planner');

  return (
    <main className="page">
      <header className="planner-head">
        <div className="brand">
          <h1>Azure Local QE Copilot</h1>
          <span className="tagline">AI-driven test case generation for Azure Local resources</span>
        </div>
      </header>

      <nav className="app-nav">
        <button
          type="button"
          className={`app-nav-btn${view === 'planner' ? ' active' : ''}`}
          onClick={() => setView('planner')}
        >
          <Pencil size={15} />
          Planner
        </button>
        <button
          type="button"
          className={`app-nav-btn${view === 'runs' ? ' active' : ''}`}
          onClick={() => setView('runs')}
        >
          <Play size={15} />
          Runs
        </button>
      </nav>

      {view === 'planner' && <PlannerView />}
      {view === 'runs' && <RunsView />}
    </main>
  );
}
