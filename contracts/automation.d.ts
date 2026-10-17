/** Spec 1 and spec 2. JSON Schemas define structural validation; see docs/automation-contracts.md for semantics. */
export type Phase = "DP" | "SP" | "M1" | "BP" | "M2" | "EP";
export type Format = "ar" | "au" | "er" | "eu" | "gr" | "gu" | "yu" | "cu" | "su" | "ru" | "uu" | "tu" | "so";
export type CardSelector = { name: string } & (
  { passcode: string; id?: never } | { id: number; passcode?: never }
);
export interface BanishSummonAction {
  schemaVersion: 1;
  requires: { sourceZone: "graveyard"; ownTurn: true; phases: Phase[]; absentFaceUpCards?: CardSelector[] };
  activation: [{ op: "banish"; card: "source" }];
  resolution: [{ op: "special-summon"; from: "deck"; card: CardSelector; positions: ("ATK" | "DEF")[];
    onNoMonsterZone?: "destroy-to-graveyard" }];
}
export type MonsterFilter = { monsterCards: CardSelector[]; monsterNamePrefixes?: never } |
  { monsterNamePrefixes: string[]; monsterCards?: never };
export interface SummonChoiceAction {
  schemaVersion: 1;
  /** ownTurn:false means either player's turn. trigger is a manually adjudicated timing declaration. */
  requires: { sourceZone: "monster"; ownTurn: false; phases: Phase[]; trigger: "normal-or-special-summon" };
  activation: [];
  resolution: [MonsterFilter & { op: "choose-search-or-destroy"; destructionMinimum?: 0 | 1;
    searchAbsentFaceUpCards: CardSelector[] }];
}
export type CardAction = BanishSummonAction | SummonChoiceAction;
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
