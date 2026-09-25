// Host data for the engine's preview token panel: the manifest-derived tab set
// re-exported by `@takazudo/zudo-sg/plugins/zdtp-apply-proxy`'s
// `virtual:zudo-sg-preview-token-panel` (`zdtpApplyProxy.tabsModule` option in
// zudo-sg.config.mjs). Without a tabs module the panel bootstrap short-circuits
// and the header trigger button opens nothing (see
// preview-token-panel-bootstrap.tsx).
import { buildUiTokenTabs } from "@takazudo/zudo-sg/token-dashboard";
import type { UiDesignTokensManifest } from "@takazudo/zudo-sg/token-dashboard";
import * as tokens from "../styleguide/token-manifest.ts";

const tokenGroups = tokens as typeof tokens & {
  UI_TOKEN_GROUPS?: UiDesignTokensManifest["groups"];
};

const uiDesignTokensManifest: UiDesignTokensManifest = {
  // UI_PALETTE_COLORS may be an empty array (some hosts have no raw palette
  // tier in their generated manifest); buildUiTokenTabs accepts that.
  paletteColors: tokens.UI_PALETTE_COLORS,
  colorTokens: tokens.UI_COLOR_TOKENS,
  spacingTokens: tokens.UI_SPACING_TOKENS,
  fontTokens: tokens.UI_FONT_TOKENS,
  sizeTokens: tokens.UI_SIZE_TOKENS,
  groups: tokenGroups.UI_TOKEN_GROUPS,
};

export const tabs = buildUiTokenTabs(uiDesignTokensManifest);
