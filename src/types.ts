export const GROUP_COLORS = [
  "grey",
  "blue",
  "red",
  "yellow",
  "green",
  "pink",
  "purple",
  "cyan",
  "orange",
] as const;

export type GroupColor = (typeof GROUP_COLORS)[number];

export interface GroupRule {
  id: string;
  name: string;
  description: string;
  color: GroupColor;
  enabled: boolean;
}

export interface RuleConfig {
  schemaVersion: 1;
  fallbackRuleId: string;
  rules: GroupRule[];
}

export type VideoPageType = "watch" | "short" | "live";

export interface VideoMetadata {
  videoId: string;
  pageType: VideoPageType;
  title: string;
  description?: string;
  channelName?: string;
  hashtags?: string[];
  playlistTitle?: string;
}

export interface ClassificationItem {
  itemId: string;
  metadata: VideoMetadata;
}

export interface ClassificationResult {
  itemId: string;
  ruleId: string;
  reason?: string;
}
