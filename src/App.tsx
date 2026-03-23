import { MarketDashboard } from './MarketDashboard';

function App() {
  return (
    <div className="app">
      <header className="app-header">
        <div className="logo">
          <span className="logo-icon">◉</span>
          <span className="logo-text">Bull Tech</span>
        </div>
        <span className="status-badge">
          <span className="pulse"></span>
          Live
        </span>
      </header>
      <main className="app-main">
        <MarketDashboard />
      </main>
    </div>
  );
}

export default App;
