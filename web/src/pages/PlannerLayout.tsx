import { useState } from 'react';
import { Home, Pencil, Play } from 'lucide-react';
import { Link } from 'react-router-dom';
import PlannerView from './PlannerView';
import RunsView from './RunsView';

type View = 'planner' | 'runs';

export default function PlannerLayout() {
  const [view, setView] = useState<View>('planner');

  return (
    <main className="page page-shell workspace-shell">
      <header className="planner-head">
        <div className="brand">
          <span className="section-label">QE Workspace</span>
          <h1>Azure Local QE Copilot</h1>
          <p className="tagline">Plan scenarios, review drafted CLI flows, and run trusted cases from one workspace.</p>
        </div>
        <nav className="workspace-switcher" aria-label="Workspace views">
          <Link className="workspace-tab" to="/">
            <Home size={16} />
            Overview
          </Link>
          <button
            type="button"
            className={`workspace-tab${view === 'planner' ? ' active' : ''}`}
            onClick={() => setView('planner')}
          >
            <Pencil size={16} />
            Planner
          </button>
          <button
            type="button"
            className={`workspace-tab${view === 'runs' ? ' active' : ''}`}
            onClick={() => setView('runs')}
          >
            <Play size={16} />
            Runs
          </button>
        </nav>
      </header>

      <section className="shell-content shell-content-wide">
        {view === 'planner' && <PlannerView />}
        {view === 'runs' && <RunsView />}
      </section>
    </main>
  );
}
