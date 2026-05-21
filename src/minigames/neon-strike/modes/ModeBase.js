// Mode — abstract base for NSA game modes. Modes own:
//   - the lifecycle (start / update / end)
//   - the win/lose condition + score formula
//   - which bots/targets spawn
//
// The Engine constructs ONE mode (selected from the pre-match
// picker) and forwards per-frame ticks + life events.

export class Mode {
  constructor(engine) { this.engine = engine; this.id = "base"; }
  // Called once when the match starts. Set up world entities here.
  start() {}
  // Called on every frame.
  update(dt) {}
  // Called by Engine to determine if the match has ended (returns
  // boolean). When true, Engine fires onMatchEnd.
  isOver() {
    return this.engine.state.time_remaining_ms <= 0;
  }
  // Compute the final score from engine.state for the registry's
  // submit endpoint. Subclasses can override.
  computeFinalScore(state) {
    return Math.min(200, state.kills * 10 + (state.best_streak || 0) * 5);
  }
  // Called once when the Engine tears down.
  destroy() {}
}
