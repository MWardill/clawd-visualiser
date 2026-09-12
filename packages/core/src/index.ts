// @clawd/core
// The contract between the local agent and the web app lives here: snapshot and ticker schemas,
// event types, ingest redaction, the state machine and the simulated source. Everything in this
// package is pure TypeScript with no browser or Node dependencies, so both apps can import it and
// both can be tested against the same fixtures.

export const CORE_VERSION = "0.0.0";
