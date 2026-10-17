# Battle damage confirmation

`extension/page/features/battle-damage.js` tracks either player's attacks in a live manual duel
and opens a nonmodal popup only for damage owed by the local player. This includes
local attacks into higher ATK or DEF. Winning local attacks, local direct attacks
and zero-damage battles stay quiet. Zero-damage battles remain tracked so a later
Honest/Kalut or board stat change can produce a prompt. The centered, translucent
popup leaves the board usable so players can resolve responses before clicking
OK. OK receives focus on opening; Enter activates the focused button, Tab and
Shift+Tab cycle between buttons, and Cancel or Escape dismisses it. Unknown
stats focus Cancel instead. The calculation details are available by hovering
over the damage amount. Nothing is sent until confirmation, and no cards are moved
or destroyed by the feature.

The calculator uses native `new_atk` / `new_def` overrides first, then printed
stats. Attack-position damage to the defender is `max(0, ATK - ATK)`. Defense
position causes no damage to the defender by default; piercing is not assumed.
A direct attack against the local player uses the attacker's ATK. For local
attacks into a monster, damage is `max(0, opposing ATK or DEF - attacking ATK)`.
`battle.damageTo` selects `attacker` or `defender` (the default) in the calculator.
Unknown stats disable confirmation. A zero difference hides an open popup; a
refund of damage already paid still requires confirmation.
The popup never applies LP damage to the attacking opponent.

The feature refreshes on the coordinator's existing recovery tick and checks
again on OK. If the amount has changed since display, the first click updates
the amount for review. Another incoming attack replaces the old battle. Unrelated local
LP messages invalidate it at receipt and execution, and confirmation also checks
LP, monster zones/control, phase/turn, duel identity and live status. This avoids
applying a pending suggestion after a manual LP adjustment or unrelated battle.
Players still cancel manually for negated attacks and special damage effects.

OK hides the popup but retains the current battle and net LP already taken.
Matching server echoes acknowledge the enhancer's LP commands without clearing
that battle. If a subsequent Honest/Kalut signal changes the calculated damage,
the popup reopens for `calculated damage - net LP already taken`. A negative
difference offers an LP refund. Each correction still requires OK and uses a
fresh guarded action helper from the triggering event. Duplicate signals do not
reopen the popup. Cancel, a new attack, phase/turn changes, missing battle monsters,
duel changes and unrelated local LP adjustments clear the retained battle.

## Honest and Kalut

During the retained battle, public hand activations (including the native Apply
effect action) and hand-to-GY moves detect Honest and Blackwing - Kalut the
Moon Shadow. Honest adds the other battling monster's current ATK to the
user's face-up LIGHT monster; Kalut adds 1400 to the user's face-up Blackwing.
Either player's boost can change the local damage suggestion. Kalut also boosts
direct attacks (for example, Gale's 1300 becomes 2700); Honest requires an opposing
monster to supply its boost amount. Unrelated graveyard/deck/field moves and
unknown card identities do not trigger these rules. Ordinary discards use the native `To GY` message: source detection
accepts pre-move hand membership (matching numeric or string instance IDs),
the native public log's `from hand` source, or `To grave from hand`. Public
message card data identifies a discarded card without reading cached hidden fronts.

The tracker counts each card instance once per battle, so activating and then
sending the same copy to the GY does not add two boosts. Different copies stack.
Honest's amount is captured at detection and stays fixed on later refreshes.
Matching board ATK increases absorb inferred boosts, including partial updates
for multiple copies, so entering those boosts manually does not add them again.
Hover over the amount to see the inferred effects.
Each detected effect also leaves a compact visible explanation, such as
`Kalut discarded · 1,300 → 2,700 damage`. The amount briefly pulses and the
explanation highlights when updated, including when a late effect reopens the
popup. The explanation stays until another effect or battle replaces it; routine
refreshes and duplicate signals do not restart the highlight. Reduced-motion
preferences disable the animation while keeping the explanation visible.

These are assumed effects, not confirmed resolutions: native messages have no
chain resolution or negation metadata. Detection uses event order rather than
simulating reverse chain resolution. Cancel the suggestion for negation or
other unusual interactions. Stat edits entered before detection or combined
with unrelated ATK changes cannot always be reconciled automatically. Tracking
lasts only for the current battle; later battles use board stats again.

Effect text references: [Honest](https://www.db.yugioh-card.com/yugiohdb/card_search.action?cid=7574&ope=2&request_locale=en)
and [Kalut](https://www.db.yugioh-card.com/yugiohdb/card_search.action?cid=8164&ope=2&request_locale=en).

## Effect extension point

`extension/shared/battle-damage.js` keeps the calculation independent of the DOM, native commands
and network events. `DBEnhancerBattleDamage.calculate(battle)` receives frozen
attacker/target snapshots (instance ID, controller username, name, current ATK,
DEF, attribute, face-down status and position), inferred effect labels, and the original duel event. It returns
`{ damage, explanation }`, where `damage: null` means unresolved.

Register named modifiers with `DBEnhancerBattleDamage.registerModifier(id, fn)`.
Each receives `(battle, previousResult)` and returns a new result, in registration
order. The returned function removes that modifier. For example, a separately
tracked effect can override a result or return `damage: null` until resolved.
Modifiers should be pure: calculation repeats during display and confirmation.

`DBEnhancerBattleDamage.createEffectTracker()` provides the per-popup hand boost
tracker. `observe(event, rawBattle)` records supported effects, and
`apply(rawBattle)` projects effective ATK before the calculator and its modifiers
run. The `HAND_BOOSTS` definitions hold eligibility and boost logic independently
of popup rendering. Future effects can extend those definitions or use a damage
modifier for piercing/prevention. Negation, chain resolution, piercing and damage
replacement rules are not currently implemented.

Run `npm run test:all` for calculator, popup/native-command and regression coverage.
See [testing](testing.md) for the required local site references.
The native stat keys, monster zones and LP command are based on the decompiled
site under `duelingbook/`; live browser validation remains separate.
