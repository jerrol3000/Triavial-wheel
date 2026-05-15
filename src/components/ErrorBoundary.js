import React from "react";

// Catches render errors anywhere in the React tree and shows a friendly
// recovery screen instead of an empty white page. Without this, a single
// thrown error in any descendant tears down the whole app — bad for a live
// product. Errors get logged to the console for debugging.
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null, info: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("[ErrorBoundary]", error, info);
    this.setState({ info });
  }

  reset = () => {
    this.setState({ error: null, info: null });
  };

  reload = () => {
    try { localStorage.removeItem("trivia-wheel:ui"); } catch (e) {}
    window.location.href = "/";
  };

  render() {
    if (!this.state.error) return this.props.children;
    const msg = this.state.error && this.state.error.message ? this.state.error.message : String(this.state.error);
    return (
      <div className="tw-app">
        <main className="tw-content tw-fade-in" style={{ paddingTop: 40 }}>
          <div className="tw-card" style={{ textAlign: "center" }}>
            <div style={{ fontSize: 56, marginBottom: 12 }}>🪲</div>
            <div style={{ fontFamily: "Fredoka", fontSize: 24, fontWeight: 700 }}>Something broke</div>
            <div style={{ color: "var(--text-dim)", margin: "8px 0 20px" }}>
              The game hit an unexpected error. Try again — if it keeps happening, refresh.
            </div>
            <div style={{
              background: "rgba(239,68,68,0.1)",
              border: "1px solid rgba(239,68,68,0.3)",
              borderRadius: 8,
              padding: 10,
              marginBottom: 20,
              fontFamily: "JetBrains Mono, monospace",
              fontSize: 12,
              textAlign: "left",
              maxHeight: 120,
              overflow: "auto",
            }}>{msg}</div>
            <div className="tw-row" style={{ justifyContent: "center" }}>
              <button className="tw-btn" onClick={this.reset}>Try again</button>
              <button className="tw-btn ghost" onClick={this.reload}>Reload</button>
            </div>
          </div>
        </main>
      </div>
    );
  }
}
