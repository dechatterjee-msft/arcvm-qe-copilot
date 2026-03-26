import { Link } from 'react-router-dom';

export default function LandingPage() {
  return (
    <main className="launch-shell">
      <section className="hero">
        <h1 className="hero-brand">AzureLocal QE Canvas</h1>
        <p className="subtitle">Intelligent Azure Local QE testing platform</p>
        <p className="description">
          Generate structured QE scenarios and editable Azure CLI flows, starting with static
          logical-network validation.
        </p>

        <ul className="points">
          <li>Targeted test generation from plain language</li>
          <li>Operator-ready Azure CLI flow for each case</li>
          <li>Validation, overlap, immutability, and cleanup coverage</li>
        </ul>

        <div className="actions">
          <Link className="action" to="/planner#prompt">Get Started</Link>
          <Link className="action secondary" to="/planner">Open Planner</Link>
        </div>

        <div className="meta">AzureLocal QE Canvas · Static logical network workflow</div>
      </section>
    </main>
  );
}
