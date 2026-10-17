# Spell/trap activation costs

Enable **Automatically pay activation LP costs** under **Automation** in the
extension settings. It is disabled by default. RPS modes and the independently
switchable battle damage suggestions also live in this settings section.

This feature targets Edison-style manual play, without restricting detection
to a particular format. It only pays the local player's Spell/Trap **card
activations**. Monster effects, Pendulum/Skill activations, and native Apply
effect actions never trigger payment. Negation does not refund an activation
cost. Other costs, including discards and Tributes, remain manual.

`extension/shared/activation-costs.js` is a pure parser. Supported patterns include:

- `Pay 1000 LP; ...`, including a preceding activation condition.
- `Pay 800 LP, then target ...; ...`.
- Older leading `Pay 1000 Life Points. ...` or `Pay 1000 Life Points to ...`.
- `Activate this card by paying 1000 LP. ...` (such as Skill Drain).
- Half-LP equivalents such as Solemn Judgment; the remaining LP round up.

It rejects multiple activation clauses, effect choices/bullets, optional
payments, variable amounts, composite costs, periodic conditions, and costs
found only later in the text. Continuous, Field, and Equip cards using an
ordinary PSCT payment clause are skipped because it might describe a later
effect; explicit card-activation payments can still be recognized. Older
wording on these persistent card types must explicitly say it activates the
card, with a small named exception for Skill Drain's leading payment.
Unsupported or unclear wording produces no payment
and no chooser. This intentionally trades coverage for fewer false charges;
it does not fully interpret card text or prove every activation is legal.

PSCT puts activation actions before the semicolon, including payments and
targeting: [Konami's PSCT explanation](https://www.yugioh-card.com/eu/play/understanding-card-text/part-4-the-clues-on-your-cards/).
[Solemn Judgment](https://www.db.yugioh-card.com/yugiohdb/card_search.action?cid=4861&ope=2&request_locale=en)
provides a half-LP activation example.

`extension/page/features/activation-costs.js` reads the native card front or supplied public
card data at event execution and uses the duel framework's guarded native LP
action. Payments therefore synchronize through Duelingbook's server and normal
LP log. Fixed costs must leave positive LP. Replays, spectating, automatic
duels, paused duels and stale games cannot pay. A face-up Spell Economics on
either field defers spell costs to the player; its negation is not inferred.
Other cost-changing effects are not modeled, so turn the feature off when
playing with those interactions, especially outside Edison.

While an LP command awaits an incoming executed local LP update, further
activation payments are skipped rather than computed from stale LP. Resetting
or leaving the game clears this reservation. Do not also subtract a detected
cost manually. Use the native LP controls to correct a payment if necessary.

There is no hosted database or additional network request. Future exceptions
can extend the parser with reviewed rules if needed. Diagnostics are available
through `DBEnhancerDiagnostics.activationCosts()` (last payment/skip and pending
status). Run `npm test` for parser, queued native activation, settings and
regression checks; testing the unpacked extension on the live site is separate.
