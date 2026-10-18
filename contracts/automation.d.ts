/** Spec 1 and spec 2. JSON Schemas define structural validation; see docs/automation-contracts.md for semantics. */
export type Phase = "DP" | "SP" | "M1" | "BP" | "M2" | "EP";
export type Format = "ar" | "au" | "er" | "eu" | "gr" | "gu" | "yu" | "cu" | "su" | "ru" | "uu" | "tu" | "so";
export type CardSelector = { name: string } & (
  { passcode: string; id?: never } | { id: number; passcode?: never }
);
export type ManualResponsibility = "activation-legality" | "responses-and-chains" | "negation" |
  "replacement-and-protection" | "movement-consequences" | "special-summon-legality" |
  "trigger-window" | "dynamic-card-properties" | "opponent-movement" | "once-per-turn";
export interface Coverage { level: "assisted"; manual: ManualResponsibility[] }
export interface AbsentFaceUpCheck { check: "absent-face-up"; cards: CardSelector[] }
export interface BanishCost { op: "banish"; card: "source"; reason: "cost" }
export interface DiscardCost { op: "discard"; from: "hand"; filter: string; count: 1; reason: "cost" }
export interface SpecialSummonOperation {
  op: "special-summon";
  from: "deck";
  card: CardSelector;
  position: { choice: string };
  reason: "effect";
  onNoMonsterZone?: { op: "destroy"; reason: "effect" };
}
export type MonsterFilter = { cardType: "monster" } & (
  { cards: CardSelector[]; namePrefixes?: never } | { namePrefixes: string[]; cards?: never }
);
export interface SearchOperation {
  op: "search"; from: "deck"; to: "hand"; filter: string; count: 1; reveal: true; shuffle: true;
  checks: AbsentFaceUpCheck[];
}
export interface DestroyOperation {
  op: "destroy";
  reason: "effect";
  selection: {
    at: "resolution"; from: "field"; players: "both"; cardTypes: ("spell" | "trap")[]; minimum: 0 | 1;
    maximum: { count: { zone: "monster"; player: "self"; faceUp: true; exclude: "source"; filter: string } };
  };
}
export interface BranchOperation {
  op: "branch"; choice: string;
  cases: Record<string, Operation[]>;
}
export interface SendToGraveyardOperation {
  op: "send-to-graveyard"; from: "deck"; filter: string; count: 1; shuffle: true; reason: "effect";
}
export type Operation = SpecialSummonOperation | SearchOperation | DestroyOperation | SendToGraveyardOperation | BranchOperation;
export interface CardAction {
  schemaVersion: 3;
  source: { zone: "graveyard" | "monster"; player: "self" };
  timing: { kind: "ignition" | "optional-trigger"; turn: "self" | "either"; phases: Phase[]; verification: "manual";
    events?: ("normal-summon" | "special-summon")[]; damageStep?: true; oncePerTurn?: "source" };
  filters: { monsters?: MonsterFilter & { attribute?: "DARK" | "LIGHT" | "EARTH" | "WATER" | "FIRE" | "WIND" | "DIVINE" } };
  activation: {
    checks: AbsentFaceUpCheck[];
    choices: ({ id: string; kind: "position"; options: ("ATK" | "DEF")[] } |
      { id: string; kind: "option"; options: string[] })[];
    costs: (BanishCost | DiscardCost)[];
    targets: [];
  };
  resolution: Operation[];
  coverage: Coverage;
}
export interface BanishSummonAction {
  schemaVersion: 3;
  source: { zone: "graveyard"; player: "self" };
  timing: { kind: "ignition"; turn: "self"; phases: Phase[]; verification: "manual" };
  filters: Record<string, never>;
  activation: {
    checks: AbsentFaceUpCheck[];
    choices: [{ id: "position"; kind: "position"; options: ("ATK" | "DEF")[] }];
    costs: [BanishCost];
    targets: [];
  };
  resolution: [SpecialSummonOperation];
  coverage: Coverage;
}
export interface SummonChoiceAction {
  schemaVersion: 3;
  source: { zone: "monster"; player: "self" };
  /** Events declare game timing; they do not install automatic native-event subscriptions. */
  timing: { kind: "optional-trigger"; turn: "either"; phases: Phase[]; verification: "manual";
    events: ("normal-summon" | "special-summon")[]; damageStep: true };
  filters: { monsters: MonsterFilter };
  activation: {
    checks: [];
    choices: [{ id: "mode"; kind: "option"; options: ("search" | "destroy")[] }];
    costs: [];
    targets: [];
  };
  resolution: [BranchOperation];
  coverage: Coverage;
}
export interface DiscardSendAction {
  schemaVersion: 3;
  source: { zone: "monster"; player: "self" };
  timing: { kind: "ignition"; turn: "self"; phases: ("M1" | "M2")[]; verification: "manual"; oncePerTurn: "source" };
  filters: { monsters: { cardType: "monster"; attribute: "DARK" | "LIGHT" | "EARTH" | "WATER" | "FIRE" | "WIND" | "DIVINE" } };
  activation: { checks: []; choices: []; costs: [{ op: "discard"; from: "hand"; filter: "monsters"; count: 1; reason: "cost" }]; targets: [] };
  resolution: [{ op: "send-to-graveyard"; from: "deck"; filter: "monsters"; count: 1; shuffle: true; reason: "effect" }];
  coverage: Coverage;
}
/** id is the stable effect ID for this card; identical IDs across enabled lists conflict. */
export interface CardRule { id: string; card: CardSelector; label: string; action: CardAction }
export interface CardRuleList {
  schemaVersion: 4;
  id: string;
  name: string;
  version: string;
  formats: Format[];
  rules: CardRule[];
  /** Storage preference only. Import forces false; export omits it. */
  enabled?: boolean;
}
export interface ContractValidator {
  /** Throws on invalid data; returns an independent copy. */
  validateAutomationAction(value: unknown): CardAction;
  validateAutomationList(value: unknown): CardRuleList & { enabled: boolean };
  importAutomationList(text: string): CardRuleList & { enabled: false };
  exportAutomationList(list: unknown): string;
  banishSummonAction(options: { card: CardSelector; phases?: Phase[]; positions?: ("ATK" | "DEF")[];
    absentFaceUpCards?: CardSelector[]; onNoMonsterZone?: "destroy" }): BanishSummonAction;
  summonChoiceAction(options: { monsterCards?: CardSelector[]; monsterNamePrefixes?: string[];
    destructionMinimum?: 0 | 1; searchAbsentFaceUpCards?: CardSelector[] }): SummonChoiceAction;
  discardSendAction(options: { attribute: DiscardSendAction["filters"]["monsters"]["attribute"] }): DiscardSendAction;
}

/** Developer API only. These callbacks cannot appear in imported JSON. */
export type Relation = "self" | "opponent" | "partner" | "unknown";
export type EventType = "summon" | "activate" | "attack" | "attack-direct" | "target" | "effect" | "set" |
  "draw" | "to-hand" | "to-deck" | "to-grave" | "to-extra" | "banish" | "move" | "flip" | "control" |
  "life-points" | "reset" | (string & {});
export type NativeId = number | string;
export interface EventCard {
  readonly instanceId: NativeId | null;
  readonly id: NativeId | null;
  readonly name: string | null;
  readonly cardType: string | null;
}
export type FrozenJson = null | boolean | number | string | readonly FrozenJson[] | { readonly [key: string]: FrozenJson };
export interface DuelEvent {
  readonly sequence: number;
  readonly type: EventType;
  readonly stage: "receive" | "execute";
  readonly play: string | null;
  readonly data: Readonly<Record<string, FrozenJson>>;
  readonly duelId: NativeId | null;
  readonly live: boolean;
  readonly phase: string | null;
  readonly turn: number | null;
  readonly actor: { readonly username: string | null; readonly relation: Relation };
  readonly card: EventCard;
  readonly attacker: EventCard | null;
  readonly target: EventCard | null;
  readonly amount: number | null;
}
export interface DuelEventActions {
  /** True means invoked a native command, not server acceptance or resolution. */
  shuffleHand(): boolean;
  adjustLifePoints(amount: number): boolean;
}
export interface DuelSubscription {
  id: string;
  includeNonLive?: boolean;
  when?: { type?: EventType; stage?: "receive" | "execute"; play?: string; actor?: Relation;
    card?: string | number; attacker?: string | number; target?: string | number };
  test?(event: DuelEvent): boolean;
  run(event: DuelEvent, actions: DuelEventActions): unknown;
}
export interface DuelEventApi {
  register(subscription: DuelSubscription): () => void;
  install(): { rules: string[]; events: number; installed: string[]; missing: string[] };
  diagnostics(): { rules: string[]; events: number; installed: string[]; missing: string[] };
}
