# Battle damage confirmation

`features/battle-damage.js` opens a nonmodal popup when an opponent attacks a
local monster or attacks directly in a live manual duel. The centered, translucent
popup leaves the board usable so players can resolve responses before clicking
OK. OK receives focus on opening; Enter activates the focused button, Tab and
Shift+Tab cycle between buttons, and Cancel or Escape dismisses it. Unknown
stats focus Cancel instead. The calculation details are available by hovering
over the damage amount. Nothing is sent until confirmation, and no cards are moved
or destroyed by the feature.

The calculator uses native `new_atk` / `new_def` overrides first, then printed
stats. Attack-position damage to the defender is `max(0, ATK - ATK)`. Defense
position causes no damage to the defender by default; piercing is not assumed.
A direct attack uses the attacker's ATK. Unknown stats disable confirmation.
The popup never applies LP damage to the attacking opponent.

The feature refreshes on the coordinator's existing recovery tick and checks
again on OK. If the amount has changed since display, the first click updates
the amount for review. Another incoming attack replaces the old popup. Local
LP messages invalidate it at receipt and execution, and confirmation also checks
LP, monster zones/control, phase/turn, duel identity and live status. This avoids
applying a pending suggestion after a manual LP adjustment or unrelated battle.
Players still cancel manually for negated attacks and special damage effects.

## Effect extension point

`battle-damage.js` keeps the calculation independent of the DOM, native commands
and network events. `DBEnhancerBattleDamage.calculate(battle)` receives frozen
attacker/target snapshots (instance ID, controller username, name, current ATK,
DEF and position) and the original duel event. It returns
`{ damage, explanation }`, where `damage: null` means unresolved.

Register named modifiers with `DBEnhancerBattleDamage.registerModifier(id, fn)`.
Each receives `(battle, previousResult)` and returns a new result, in registration
order. The returned function removes that modifier. For example, a separately
tracked effect can override a result or return `damage: null` until resolved.
Modifiers should be pure: calculation repeats during display and confirmation.

Future Honest/Kalut support can observe duel events through
`DBEnhancerDuelEvents.register`, track a confirmed effect by battle/card instance,
and feed that state into a modifier. Activation or sending a card to the GY
alone does not establish resolution. Avoid adding a boost twice when the board
already includes it, and clear tracked effects on battle/game transitions.
No Honest/Kalut detection, negation handling, piercing or damage replacement
rules are currently installed.

Run `node --test` for calculator, popup/native-command and regression coverage.
The native stat keys, monster zones and LP command are based on the decompiled
site under `duelingbook/`; live browser validation remains separate.
