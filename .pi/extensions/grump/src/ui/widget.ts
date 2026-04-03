import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import { colorizeRarity, RARITY_COLORS, RESET } from "../domain/identity.js";
import type { GrumpConfig, GrumpIdentity, GrumpPresentation, RuntimeState } from "../domain/types.js";
import { now, truncate, wrapPlainText } from "../utils/text.js";

const SPRITES: Record<string, string[][]> = {
  common: [
    ["   ______   ", "  [______]  ", " ( {E}    {E} ) ", "  (  __  )  ", "   `----´   "],
    ["   ______   ", "  [______]  ", " ( {E}    {E} ) ", "  ( .--. )  ", "   `----´   "],
    ["   ______   ", "  [______]  ", " ( {E}    {E} ) ", "  (  __  )  ", "   `----´   "],
  ],
  "common-bald": [
    ["            ", "   _,--,_   ", "  (>{E}  {E}<)  ", "   ( <> )   ", "   `----´   "],
    ["            ", "   _,--,_   ", "  (>{E}  {E}<)  ", "   ( <> )   ", "   `=--=´   "],
    ["            ", "   _,--,_   ", "  (>{E}  {E}<)  ", "   ( <> )   ", "   `----´   "],
  ],
  "common-scruff": [
    ["            ", "   .////.   ", "  (~{E}  {E}~)  ", "   ( ,_, )  ", "   `----´   "],
    ["            ", "   .////.   ", "  (~{E}  {E}~)  ", "   ( ._. )  ", "   `----´   "],
    ["            ", "   .////.   ", "  (~{E}  {E}~)  ", "   ( ,_, )  ", "   `----´   "],
  ],
  "common-moustache": [
    ["            ", "   .----.   ", "  ( {E}  {E} )  ", "  ( ,~~, )  ", "   `----´   "],
    ["            ", "   .----.   ", "  ( {E}  {E} )  ", "  ( ,__, )  ", "   `----´   "],
    ["            ", "   .----.   ", "  ( {E}  {E} )  ", "  ( ,~~, )  ", "   `----´   "],
  ],
  "common-flat": [
    ["            ", "   .____.   ", "  (>{E}  {E}<)  ", "   (  -- )  ", "   `----´   "],
    ["            ", "   .____.   ", "  (>{E}  {E}<)  ", "   (  __ )  ", "   `----´   "],
    ["            ", "   .____.   ", "  (>{E}  {E}<)  ", "   (  -- )  ", "   `----´   "],
  ],
  rare: [
    ["            ", "   .----.   ", " [({E})--({E})] ", "   | <> |   ", "   `----´   "],
    ["            ", "   .----.   ", " [({E})--({E})] ", "   | <> |   ", "   `=--=´   "],
    ["            ", "   .----.   ", " [({E})--({E})] ", "   | <> |   ", "   `----´   "],
  ],
  "rare-scruffy": [
    ["            ", "  .//////.  ", " (~{E}    {E}~) ", "  ( ,__, )  ", "   `----´   "],
    ["            ", "  .//////.  ", " (~{E}    {E}~) ", "  ( .--. )  ", "   `----´   "],
    ["            ", "  .//////.  ", " (~{E}    {E}~) ", "  ( ,__, )  ", "   `----´   "],
  ],
  "rare-fuzz": [
    ["  ._////_.  ", " ( /____\\ ) ", " (>{E}    {E}<) ", "  ( ,_, )   ", "   `----´   "],
    ["  ._////_.  ", " ( /____\\ ) ", " (>{E}    {E}<) ", "  ( ._. )   ", "   `----´   "],
    ["  ._////_.~ ", " ( /____\\ ) ", " (>{E}    {E}<) ", "  ( ,_, )   ", "   `----´   "],
  ],
  epic: [
    ["  _/^^^^\\_  ", " (  {E}  {E}  ) ", "  ( ,<>, )  ", "  |<~~~~>|  ", "   `----´   "],
    ["  _/^^^^\\_  ", " (  {E}  {E}  ) ", "  ( ,__, )  ", "  |<~~~~>|  ", "   `----´   "],
    ["  _/^^^^\\_  ", " (  {E}  {E}  ) ", "  ( ,<>, )  ", "  |<~~~~>|  ", "   `----´   "],
  ],
  "epic-wizard": [
    ["    /^^\\    ", "   /    \\   ", "  ( {E}  {E} )  ", "  ( ,__, )  ", "  /`----´\\  "],
    ["    /^^\\    ", "   /    \\   ", "  ( {E}  {E} )  ", "  ( .__. )  ", "  /`----´\\  "],
    ["    /^^\\    ", "   /    \\   ", "  ( {E}  {E} )  ", "  ( ,__, )  ", "  /`----´\\  "],
  ],
  gramps: [
    [" \\|^^^^|/ ", " (({E})-({E})) ", " (  __   ) ", " /|     |\\ ", "  /_/ \\_\\  "],
    [" \\|^^^^|/ ", " (({E})-({E})) ", " (  --   ) ", " \\|     |/ ", "  /_/ \\_\\  "],
    [" \\|^^^^|/ ", " (({E})-({E})) ", " (  __   ) ", " /|     |\\ ", "  /_/ \\_\\  "],
  ],
  pi: [
    ["            ", " ==========;", "  | {E}  {E} | ", "  | --   |   ", "  |      \\  "],
    ["            ", " ==========;", "  | {E}  {E} | ", "  | .    |   ", "  /      \\  "],
    ["            ", " ==========;", "  | {E}  {E} | ", "  | --   |   ", "  |      \\  "],
  ],
};

const COMPACT_FACES: Record<string, string> = {
  common: "[{E}_{E}]",
  "common-bald": "(>{E}{E}<)",
  "common-scruff": "(~{E}{E}~)",
  "common-moustache": "({E}~~{E})",
  "common-flat": "(>{E}{E}<)",
  rare: "[({E})({E})]",
  "rare-scruffy": "(~{E}..{E}~)",
  "rare-fuzz": "(>{E}..{E}<)",
  epic: "<~{E}{E}~>",
  "epic-wizard": "<{{E}{E}}>",
  gramps: "(>{E}{E}<)",
  pi: "|{E}π{E}|",
};

function getAnimatedMotion(nowMs = now()): { frameIndex: number; blink: boolean } {
  const bodyStep = Math.floor(nowMs / 220) % 16;
  let frameIndex = 0;
  if (bodyStep === 6 || bodyStep === 7) frameIndex = 1;
  else if (bodyStep === 12) frameIndex = 2;
  const blinkPhase = nowMs % 4800;
  const blink = (blinkPhase >= 0 && blinkPhase < 120) || (blinkPhase >= 170 && blinkPhase < 290);
  return { frameIndex, blink };
}

export function renderSprite(identity: GrumpIdentity, frameIndex: number, blink: boolean): string[] {
  const eye = blink ? "-" : "•";
  const frames = SPRITES[identity.spriteVariant] ?? SPRITES.common;
  let frame = (frames[frameIndex % frames.length] ?? frames[0]).map((line) => line.replaceAll("{E}", eye));
  while (frame.length > 1 && !frame[0]?.trim()) frame = frame.slice(1);
  return frame;
}

function renderFace(identity: GrumpIdentity, blink: boolean): string {
  const template = COMPACT_FACES[identity.spriteVariant] ?? COMPACT_FACES.common;
  return template.replaceAll("{E}", blink ? "-" : "•");
}

function isReactionVisible(state: RuntimeState, config: GrumpConfig, at = now()): boolean {
  if (!state.reactionText || !state.reactionStartedAt) return false;
  return at - state.reactionStartedAt < config.ui.reactionShowMs;
}

function isReactionFading(state: RuntimeState, config: GrumpConfig, at = now()): boolean {
  return isReactionVisible(state, config, at) && !!state.reactionStartedAt && at - state.reactionStartedAt >= config.ui.reactionShowMs - config.ui.reactionFadeMs;
}

function dim(line: string, fading: boolean): string {
  return fading ? `\x1b[2m${line}${RESET}` : line;
}

function renderSpeechBubble(text: string, fading: boolean, maxCols: number): { lines: string[]; tailRow: number } {
  const bubbleMaxCols = Math.max(18, Math.min(42, maxCols));
  const wrapWidth = Math.max(12, bubbleMaxCols - 4);
  const wrapped = wrapPlainText(text, wrapWidth);
  const longest = Math.max(...wrapped.map((line) => line.length), 0);
  const totalWidth = Math.max(18, Math.min(bubbleMaxCols, longest + 4));
  const innerWidth = Math.max(12, totalWidth - 4);
  const top = `╭${"─".repeat(innerWidth + 2)}╮`;
  const bottom = `╰${"─".repeat(innerWidth + 2)}╯`;
  const body = wrapped.map((line) => `│ ${line.padEnd(innerWidth, " ")} │`);
  const tailBodyRow = Math.min(body.length - 1, Math.max(0, Math.floor(body.length / 2)));
  if (body[tailBodyRow]) body[tailBodyRow] = `${body[tailBodyRow]}──`;
  return { lines: [top, ...body, bottom].map((line) => dim(line, fading)), tailRow: tailBodyRow + 1 };
}

function measure(lines: string[]): number {
  return Math.max(...lines.map((line) => visibleWidth(line)), 0);
}

export function buildPresentation(identity: GrumpIdentity | null, state: RuntimeState, config: GrumpConfig, availableCols: number, forceWide = false): GrumpPresentation | null {
  if (!identity || !config.enabled || state.muted) return null;
  const at = now();
  const reactionText = isReactionVisible(state, config, at) ? state.reactionText : null;
  const fading = isReactionFading(state, config, at);
  const compact = !forceWide && availableCols < config.ui.minColsFullSprite;
  const motion = getAnimatedMotion(at);

  if (compact) {
    const coloredName = colorizeRarity(identity.name, identity.rarity);
    const laneLines = [reactionText ? `${renderFace(identity, motion.blink)} ${truncate(reactionText, 24)}` : `${renderFace(identity, motion.blink)} ${coloredName}`];
    return { laneLines, laneWidth: measure(laneLines), bubbleLines: [], bubbleWidth: 0, bubbleTailRow: 0, laneAnchorRow: 0, compact: true };
  }

  const spriteLines = renderSprite(identity, motion.frameIndex, motion.blink);
  const spriteWidth = measure(spriteLines);
  const centeredName = `${" ".repeat(Math.max(0, Math.floor((spriteWidth - identity.name.length) / 2)))}${identity.name}`;
  const laneLines = [...spriteLines, `${RARITY_COLORS[identity.rarity]}${centeredName}${RESET}`];
  const bubble = reactionText
    ? renderSpeechBubble(reactionText, fading, Math.min(42, Math.max(18, Math.floor(availableCols * 0.33))))
    : { lines: [], tailRow: 0 };
  const laneAnchorRow = Math.max(0, Math.floor((spriteLines.length - 1) / 2) - 1);
  return { laneLines, laneWidth: measure(laneLines), bubbleLines: bubble.lines, bubbleWidth: measure(bubble.lines), bubbleTailRow: bubble.tailRow, laneAnchorRow, compact: false };
}

export function renderFallbackLines(identity: GrumpIdentity | null, state: RuntimeState, config: GrumpConfig, cols: number): string[] | undefined {
  if (!identity || !config.enabled || state.muted) return undefined;
  const presentation = buildPresentation(identity, state, config, cols, false);
  if (!presentation) return undefined;
  if (presentation.compact) return presentation.laneLines.map((line) => truncateToWidth(line, cols));
  return [...presentation.bubbleLines, ...presentation.laneLines].map((line) => truncateToWidth(line, cols));
}
