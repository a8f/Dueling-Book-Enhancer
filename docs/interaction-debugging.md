# Interaction audit and diagnostics

Reviewed all registered features, startup/lifecycle handling, the storage bridge, CSS, and duel event hooks against the local `duelingbook/main.js`, `duelingbook/duel.js` and recorded traffic. The intermittent reported lockup has not been reproduced in a live duel; these changes address failure paths and collect evidence for the next occurrence.

| Area | Findings and handling |
| --- | --- |
| Native controls | `endTurnE` and `startTurnE` silently return while `clickedRecently` is true. Capture clicks, guard state, command calls, socket sends and incoming events separately. Snapshot pointer styles, blocking ancestors and the element at each control's center to identify invisible overlays. |
| Animation queue / duel rules | `performNextAction` sets `stopQueue` before calling the queue head; an exception before `endAction` can leave it stopped. Log native handler/queue errors and unchanged queue heads. If the optional queue `push` hook cannot install, invoke native dispatch exactly once anyway. Preserve native exceptions and never force queue advancement. Rule failures remain isolated. |
| Connection monitor | Previously omitted End/Start turn. Track their matching echoes even if opponent messages continue. Isolate post-send observation errors so successful native sends retain their return value. Log socket errors and health transitions; no retries or reconnect changes. |
| Startup | Feature constructor failures previously aborted creation of every later feature. Isolate constructors as well as lifecycle calls, record feature/method errors, and protect event-hook recovery. |
| Sorting | Found an undefined `normalizedCardName` call in copy counting, causing non-default custom sorts to fall back to native sorting. Normalize locally and cover actual button execution with a regression test. |
| Rooms / hosting | Click interception is scoped to room arrows. Host/default changes affect host controls and room layout; they do not modify duel controls. |
| Card pools / deck memory | Search-region interception is scoped to native TCG/OCG inputs for a selected custom pool. Deck-load wrapper calls native first and isolates restoration failures. |
| Appearance | Changes color/background properties and the grid layer. No broad pointer or click interception. |
| RPS / turn order | Automation clicks native card contents only when eligible; injected controls live within their panels. No duel-wide pointer lock. |
| Battle damage / activation costs | Rules have individual error boundaries and stale-game guards. Damage keyboard interception applies within its own panel, which has no full-page backdrop. Pending LP actions use native commands and do not modify queue locks. |
| Hand shuffle | Native Send wrapper forwards arguments/receiver/result; pending automation observes game/hand/pointer guards. Debug Send hooks recognize the shuffle wrapper's original-function chain to avoid repeated wrapping on recovery ticks. |
| Settings bridge | Storage errors already log locally. A report includes whether settings ever arrived, plus active automation preferences; it does not export storage or hosting passwords. |

`extension/page/features/debugging.js` installs passive capture listeners (no canceled clicks), native error/command observation and local report export. It uses the existing 500 ms recovery tick. Control snapshots are computed only on manual export or an observed click with no command. Native handlers bound before injection can bypass the handler wrapper, so document click capture and actual socket observation provide complementary evidence. No-command warnings are observations, not proof of a bug.

Reports use schema version 1 and retain up to 300 chronological entries, coalescing adjacent identical entries. They deliberately summarize state rather than serialize the cyclic native game/DOM graph. Native functions' names and stacks identify failures; no function bodies are exported. Long queue waits can be legitimate, especially during animations or prompts. Do not infer a server rejection solely from a timeout, or retry a game action from a diagnostic report.
