/**
 * Vitest setup for the browser-half tests.
 *
 * React 18 renders concurrently: `root.render()` schedules work rather than
 * committing it, so a test that asserts on the DOM right after rendering is
 * racing the scheduler. Declaring the act environment lets the specs wrap
 * rendering and flushing in `act(...)`, which drains React's queues
 * deterministically instead of relying on a timer being long enough.
 */
declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true

export {}
