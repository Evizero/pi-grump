import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import { RARITY_COLORS, RESET } from "../domain/identity.js";
import type { GrumpIdentity, RuntimeState } from "../domain/types.js";
import { replaceTimer } from "../utils/timers.js";
import { renderSprite } from "./widget.js";

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
  const borderAnsi = RARITY_COLORS[state.identity.rarity];
  const paintBorder = (text: string) => `${borderAnsi}${text}${RESET}`;
  const result = await ctx.ui.custom<boolean>((_tui: any, theme: any, _kb: any, done: (value: boolean) => void) => ({
    render(width: number) {
      const lines = getCardSummaryLines(state.identity!, state.reactionHistory.at(-1) ?? null, backendSummary ?? state.reactionBackendSummary);
      const maxInner = Math.max(18, width - 4);
      const measuredInner = Math.max(...lines.map((line) => visibleWidth(truncateToWidth(line, maxInner))), 0);
      const inner = Math.max(18, Math.min(maxInner, measuredInner));
      const totalWidth = inner + 2;
      const leftPad = " ".repeat(Math.max(0, Math.floor((width - totalWidth) / 2)));
      const border = `${leftPad}${paintBorder(`╭${"─".repeat(inner)}╮`)}`;
      const footer = `${leftPad}${paintBorder(`╰${"─".repeat(inner)}╯`)}`;
      const side = (text: string) => {
        const content = truncateToWidth(text, inner);
        const padding = Math.max(0, inner - visibleWidth(content));
        return `${leftPad}${paintBorder("│")}${theme.fg("text", `${content}${" ".repeat(padding)}`)}${paintBorder("│")}`;
      };
      const body = lines.map((line) => side(line));
      return [border, ...body, footer];
    },
    invalidate() {},
    handleInput() { done(true); },
  }), { overlay: true });
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
