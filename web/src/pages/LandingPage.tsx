import { ArrowRight, Cloud, GitBranch, MessageSquare, Shield } from 'lucide-react';
import { Link } from 'react-router-dom';

export default function LandingPage() {
  const capabilities = [
    {
      icon: Cloud,
      title: 'Targeted Azure scope',
      description: 'Lock planning and execution to the exact subscription, resource group, and custom location.',
    },
    {
      icon: GitBranch,
      title: 'CLI-first plan generation',
      description: 'Review editable Azure CLI flows before anything is accepted or executed.',
    },
    {
      icon: Shield,
      title: 'Operational validation',
      description: 'Drive overlap, immutability, cleanup, and lifecycle coverage from one planner.',
    },
    {
      icon: MessageSquare,
      title: 'Run analysis workspace',
      description: 'Inspect logs, flight recorder output, and AI guidance in the same console.',
    },
  ];

  return (
    <main className="launch-shell">
      <section className="hero surface">
        <div className="hero-grid">
          <div className="hero-copy">
            <h1 className="hero-brand">Azure Local QE Copilot</h1>
            <p className="subtitle">Plan, validate, execute, and inspect Azure Local scenarios from one console.</p>
            <p className="description">
              Generate structured QE scenarios, edit operator-ready Azure CLI flows, monitor run
              execution, and review operator logs in a Fluent-style workspace.
            </p>

            <ul className="points">
              <li>Targeted test generation from plain language and attached context</li>
              <li>Editable Azure CLI command flows for every generated case</li>
              <li>Run telemetry, operator logs, and AI-assisted diagnosis in one place</li>
            </ul>

            <div className="actions">
              <Link className="action" to="/planner">
                Open Workspace
                <ArrowRight size={16} />
              </Link>
              <Link className="action secondary" to="/planner#prompt">
                Start With Planner
              </Link>
            </div>
          </div>

          <div className="hero-side">
            {capabilities.map(({ icon: Icon, title, description }) => (
              <article key={title} className="hero-feature">
                <div className="hero-feature-icon">
                  <Icon size={18} />
                </div>
                <div className="hero-feature-copy">
                  <strong>{title}</strong>
                  <span>{description}</span>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
