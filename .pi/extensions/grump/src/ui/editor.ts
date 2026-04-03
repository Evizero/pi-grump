import { CustomEditor } from "@mariozechner/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import type { GrumpConfig, GrumpIdentity, RuntimeState } from "../domain/types.js";
import { highlightGrumpTriggers } from "../utils/text.js";
import { buildPresentation, renderFallbackLines } from "./widget.js";

type PresentationGetter = () => { identity: GrumpIdentity | null; state: RuntimeState; config: GrumpConfig };

class GrumpEditor extends CustomEditor {
  constructor(tui: any, theme: any, keybindings: any, private readonly getPresentation: PresentationGetter) {
    super(tui, theme, keybindings);
  }

  override render(width: number): string[] {
    const { identity, state, config } = this.getPresentation();
    state.editorActive = true;
    state.lastKnownCols = width;
    const baseFullWidth = super.render(width).map((line) => highlightGrumpTriggers(line));
    const canShowWide = !!identity && config.enabled && !state.muted && width >= config.ui.minColsFullSprite;
    if (!canShowWide) {
      const fallback = renderFallbackLines(identity, state, config, width) ?? [];
      return fallback.length ? [...baseFullWidth, ...fallback.map((line) => highlightGrumpTriggers(truncateToWidth(line, width)))] : baseFullWidth;
    }

    const presentation = buildPresentation(identity, state, config, width, true);
    if (!presentation) return baseFullWidth;

    const laneWidth = Math.max(14, presentation.laneWidth + 1);
    const gap = 2;
    const editorWidth = Math.max(24, width - laneWidth - gap);
    const bubbleLines = presentation.bubbleLines.map((line) => highlightGrumpTriggers(line));
    const bubbleToBuddyGap = bubbleLines.length > 0 ? 0 : gap;
    const bubbleWidth = bubbleLines.length ? Math.max(...bubbleLines.map((line) => visibleWidth(line)), 0) : 0;
    const bubbleEditorWidth = bubbleLines.length ? Math.max(18, editorWidth - bubbleWidth - bubbleToBuddyGap) : editorWidth;
    const base = super.render(editorWidth).map((line) => highlightGrumpTriggers(line));
    const bubbleTopPadding = bubbleLines.length ? Math.max(0, presentation.laneAnchorRow - presentation.bubbleTailRow - 1) : 0;
    const laneLines = presentation.laneLines.map((line) => truncateToWidth(line, laneWidth));
    const placedBubbleLines = [...Array.from({ length: bubbleTopPadding }, () => ""), ...bubbleLines];
    const totalLines = Math.max(base.length, laneLines.length, placedBubbleLines.length);
    const output: string[] = [];

    for (let i = 0; i < totalLines; i++) {
      const lane = laneLines[i] ?? "";
      const bubble = placedBubbleLines[i] ?? "";
      if (bubble) {
        const left = truncateToWidth(base[i] ?? "", bubbleEditorWidth, "");
        const leftPad = Math.max(0, bubbleEditorWidth - visibleWidth(left));
        const bubblePad = Math.max(0, bubbleWidth - visibleWidth(bubble));
        output.push(truncateToWidth(`${left}${" ".repeat(leftPad + gap)}${bubble}${" ".repeat(bubblePad + bubbleToBuddyGap)}${lane}`, width));
      } else {
        const left = base[i] ?? "";
        const leftPad = Math.max(0, editorWidth - visibleWidth(left));
        output.push(truncateToWidth(`${left}${" ".repeat(leftPad + gap)}${lane}`, width));
      }
    }
    return output;
  }
}

export function createGrumpEditorFactory(getPresentation: PresentationGetter, onRenderRequestAvailable?: (fn: () => void) => void) {
  return (tui: any, theme: any, keybindings: any) => {
    onRenderRequestAvailable?.(() => tui.requestRender());
    return new GrumpEditor(tui, theme, keybindings, getPresentation);
  };
}
