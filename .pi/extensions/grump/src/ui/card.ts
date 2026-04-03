import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import { colorizeRarity, RARITY_COLORS, RESET } from "../domain/identity.js";
import type { GrumpIdentity, RuntimeState, StatName } from "../domain/types.js";
import { replaceTimer } from "../utils/timers.js";
import { renderSprite } from "./widget.js";

const GRUMP_CARD_WIDTH = 64;
const STAT_BAR_MAX = 20;

const STAT_LABELS: Record<StatName, string> = {
  GRUMP: "GRM",
  WIT: "WIT",
  YAGNI: "YAG",
  OBSERVABILITY: "OBS",
  DISCIPLINE: "DIS",
  CRAFT: "CRF",
  PARANOIA: "PAR",
};

function renderStatBar(label: string, value: number, inner: number, theme: any): string {
  const filled = Math.max(1, Math.round((value / 100) * STAT_BAR_MAX));
  const empty = STAT_BAR_MAX - filled;
  const tag = label.padEnd(4, " ");
  const num = String(value).padStart(3, " ");
  const bar = `${theme.fg("accent", "█".repeat(filled))}${theme.fg("dim", "░".repeat(empty))}`;
  const line = ` ${theme.fg("dim", tag)}${num} ${bar}`;
  return line;
}

export function getCardSummaryLines(identity: GrumpIdentity, lastSaid: string | null, backendSummary?: string | null): string[] {
  const lines: string[] = [];
  lines.push(`${identity.name} · ${identity.rarity}`);
  lines.push(...renderSprite(identity, 0, false));
  for (const [name, value] of Object.entries(identity.stats)) {
    const bar = "█".repeat(Math.max(1, Math.round((value as number) / 10)));
    lines.push(`${name.padEnd(13, " ")} ${String(value).padStart(3, " ")} ${bar}`);
  }
  if (lastSaid) lines.push(`last muttered: ${lastSaid}`);
  if (backendSummary) lines.push(backendSummary);
  lines.push("say /grump whisper <text> · /grump off · /grump reset");
  lines.push("press any key");
  return lines;
}

export async function openGrumpCard(ctx: ExtensionContext, state: RuntimeState, backendSummary?: string | null): Promise<boolean> {
  if (!ctx.hasUI || !state.identity) return false;
  const identity = state.identity;
  const borderAnsi = RARITY_COLORS[identity.rarity];
  const paintBorder = (text: string) => `${borderAnsi}${text}${RESET}`;
  const result = await ctx.ui.custom<boolean>((_tui: any, theme: any, _kb: any, done: (value: boolean) => void) => ({
    render(width: number) {
      const inner = Math.max(1, width - 2);
      const out: string[] = [];

      const row = (content: string) => {
        const truncated = truncateToWidth(content, inner);
        const pad = Math.max(0, inner - visibleWidth(truncated));
        return `${paintBorder("│")}${truncated}${" ".repeat(pad)}${paintBorder("│")}`;
      };
      const centeredRow = (content: string) => {
        const truncated = truncateToWidth(content, inner);
        const contentWidth = visibleWidth(truncated);
        const leftPad = Math.max(0, Math.floor((inner - contentWidth) / 2));
        const rightPad = Math.max(0, inner - contentWidth - leftPad);
        return `${paintBorder("│")}${" ".repeat(leftPad)}${truncated}${" ".repeat(rightPad)}${paintBorder("│")}`;
      };
      const blank = () => row("");
      const separator = () => `${paintBorder("├")}${paintBorder("─".repeat(inner))}${paintBorder("┤")}`;

      // top border
      out.push(paintBorder(`╭${"─".repeat(inner)}╮`));
      out.push(blank());

      // centered sprite
      for (const spriteLine of renderSprite(identity, 0, false)) {
        out.push(centeredRow(spriteLine));
      }

      // name + rarity
      out.push(blank());
      out.push(centeredRow(colorizeRarity(theme.bold(identity.name), identity.rarity)));
      out.push(centeredRow(theme.fg("dim", identity.rarity)));

      // separator
      out.push(separator());

      // stat bars – temperament
      out.push(row(theme.fg("muted", " temperament")));
      for (const name of ["GRUMP", "WIT"] as StatName[]) {
        out.push(row(renderStatBar(STAT_LABELS[name], identity.stats[name], inner, theme)));
      }

      // stat bars – concerns
      out.push(blank());
      out.push(row(theme.fg("muted", " concerns")));
      for (const name of ["YAGNI", "OBSERVABILITY", "DISCIPLINE", "CRAFT", "PARANOIA"] as StatName[]) {
        out.push(row(renderStatBar(STAT_LABELS[name], identity.stats[name], inner, theme)));
      }

      // separator
      out.push(separator());

      // last muttered
      const lastSaid = state.reactionHistory.at(-1) ?? null;
      const backend = backendSummary ?? state.reactionBackendSummary;
      if (lastSaid) {
        const truncatedQuote = truncateToWidth(lastSaid, inner - 4);
        out.push(row(` ${theme.fg("dim", "\"")}${theme.fg("text", truncatedQuote)}${theme.fg("dim", "\"")} `));
      }
      if (backend) {
        out.push(row(` ${theme.fg("dim", backend)}`));
      }
      if (lastSaid || backend) {
        out.push(separator());
      }

      // help footer
      out.push(row(theme.fg("dim", " /grump whisper · /grump off · /grump reset")));
      out.push(row(theme.fg("dim", " press any key to close")));

      // bottom border
      out.push(paintBorder(`╰${"─".repeat(inner)}╯`));

      return out;
    },
    invalidate() {},
    handleInput() { done(true); },
  }), {
    overlay: true,
    overlayOptions: { anchor: "center", width: GRUMP_CARD_WIDTH, minWidth: GRUMP_CARD_WIDTH },
  });
  return result === true;
}

export async function showManifestPresentation(ctx: ExtensionContext, state: RuntimeState): Promise<void> {
  if (!ctx.hasUI) return;
  const frames = ["(  )", "(. )", "(..)", "(..*)", "(hrmph) manifested"];
  await ctx.ui.custom<void>((tui: any, theme: any, _kb: any, done: () => void) => {
    let frame = 0;
    replaceTimer(state, "manifestFrame", setInterval(() => {
      frame += 1;
      if (frame >= frames.length) {
        replaceTimer(state, "manifestFrame", undefined);
        done();
        return;
      }
      tui.requestRender();
    }, 350));
    return {
      render(width: number) {
        const text = theme.fg("accent", frames[Math.min(frame, frames.length - 1)]!);
        const pad = Math.max(0, Math.floor((width - text.length) / 2));
        return [" ".repeat(pad) + text];
      },
      invalidate() {},
      handleInput() { done(); },
    };
  }, { overlay: true });
}
