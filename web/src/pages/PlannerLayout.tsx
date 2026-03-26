import { useState } from 'react';
import { Home, Pencil, Play } from 'lucide-react';
import { Link } from 'react-router-dom';
import PlannerView from './PlannerView';
import RunsView from './RunsView';

type View = 'planner' | 'runs';

export default function PlannerLayout() {
  const [view, setView] = useState<View>('planner');

  return (
    <main className="page page-shell">
      <header className="planner-head surface">
        <div className="brand">
          <h1>Azure Local QE Copilot</h1>
        </div>
      </header>

      <div className="workspace-layout">
        <aside className="surface shell-sidebar">
          <Link className="home-link" to="/">
            <Home size={16} />
            Overview
          </Link>

          <div className="sidebar-section-title">Workspace</div>
          <nav className="app-nav app-nav-vertical">
            <button
              type="button"
              className={`app-nav-btn${view === 'planner' ? ' active' : ''}`}
              onClick={() => setView('planner')}
            >
              <Pencil size={17} />
              <span className="app-nav-copy">
                <strong>Planner</strong>
                <span>Create and refine QE scenarios</span>
              </span>
            </button>
            <button
              type="button"
              className={`app-nav-btn${view === 'runs' ? ' active' : ''}`}
              onClick={() => setView('runs')}
            >
              <Play size={17} />
              <span className="app-nav-copy">
                <strong>Runs</strong>
                <span>Inspect execution and logs</span>
              </span>
            </button>
          </nav>
        </aside>

        <section className="shell-content">
          {view === 'planner' && <PlannerView />}
          {view === 'runs' && <RunsView />}
        </section>
      </div>
    </main>
  );
}
