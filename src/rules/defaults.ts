import type { RuleConfig } from "../types";

const DEFAULT_RULE_CONFIG: RuleConfig = {
  schemaVersion: 1,
  fallbackRuleId: "uncategorized",
  rules: [
    {
      id: "programming",
      name: "Programming",
      color: "green",
      enabled: true,
      description:
        "Software development, programming languages, frameworks, software architecture, developer tools, coding tutorials, and software engineering.",
    },
    {
      id: "fishing",
      name: "Fishing",
      color: "blue",
      enabled: true,
      description:
        "Recreational fishing, fishing techniques, tackle, lures, fish species, fishing equipment, and fishing trips.",
    },
    {
      id: "photography",
      name: "Photography",
      color: "pink",
      enabled: true,
      description:
        "Cameras, lenses, analog and digital photography, lighting, composition, shooting techniques, and photographic editing.",
    },
    {
      id: "history",
      name: "History",
      color: "yellow",
      enabled: true,
      description:
        "Historical people, events, civilizations, periods, primary sources, and historical analysis.",
    },
    {
      id: "gaming",
      name: "Gaming",
      color: "purple",
      enabled: true,
      description:
        "Video games, gameplay, esports, reviews, game design, and game lore. Software implementation is primarily Programming.",
    },
    {
      id: "technology",
      name: "Technology",
      color: "cyan",
      enabled: true,
      description:
        "Consumer and industry technology, electronics, devices, computing products, and technology trends that are not mainly software development.",
    },
    {
      id: "science",
      name: "Science",
      color: "orange",
      enabled: true,
      description:
        "Scientific subjects, research, experiments, mathematics, nature, medicine, and space.",
    },
    {
      id: "music",
      name: "Music",
      color: "red",
      enabled: true,
      description:
        "Music, performances, instruments, composition, theory, recording, and production.",
    },
    {
      id: "entertainment",
      name: "Entertainment",
      color: "grey",
      enabled: true,
      description:
        "Film, television, comedy, celebrity, and pop culture. This is a subject category, not a label for anything entertaining.",
    },
    {
      id: "uncategorized",
      name: "Uncategorized",
      color: "grey",
      enabled: true,
      description: "Use only when no enabled topical category is sufficiently appropriate.",
    },
  ],
};

export function createDefaultRuleConfig(): RuleConfig {
  return structuredClone(DEFAULT_RULE_CONFIG);
}
