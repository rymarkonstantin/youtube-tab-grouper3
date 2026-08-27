import type { RunProgress, RunSummary } from "../run/types";
import { classificationProgressView } from "./provider-state";
export type PanelState =
  | { kind: "checking" }
  | { kind: "needs-activation"; capability: string }
  | { kind: "running"; progress: RunProgress }
  | { kind: "complete"; summary: RunSummary }
  | { kind: "unavailable"; message: string }
  | { kind: "configuration-error"; message: string }
  | { kind: "cancelled" }
  | { kind: "error"; message: string };
export interface PanelViewModel {
  heading: string;
  message: string;
  progress: { value: number; max: number } | null;
  prepareVisible: boolean;
  cancelVisible: boolean;
  runAgainVisible: boolean;
  editVisible: boolean;
}
export function toPanelViewModel(state: PanelState): PanelViewModel {
  switch (state.kind) {
    case "checking":
      return {
        heading: "Checking tabs",
        message: "Preparing to group YouTube videos…",
        progress: null,
        prepareVisible: false,
        cancelVisible: false,
        runAgainVisible: false,
        editVisible: false,
      };
    case "needs-activation":
      return {
        heading: "AI preparation required",
        message: `Prepare ${state.capability} to continue.`,
        progress: null,
        prepareVisible: true,
        cancelVisible: false,
        runAgainVisible: false,
        editVisible: false,
      };
    case "running":
      return {
        heading: "Grouping YouTube tabs",
        message:
          state.progress.classification === undefined
            ? `Working: ${state.progress.phase}`
            : `Working: ${state.progress.phase}. ${classificationProgressView(state.progress.classification)}`,
        progress: { value: state.progress.completed, max: Math.max(state.progress.total, 1) },
        prepareVisible: false,
        cancelVisible: true,
        runAgainVisible: false,
        editVisible: false,
      };
    case "complete":
      return {
        heading: "Grouping complete",
        message: `${state.summary.grouped} grouped, ${state.summary.failed} failed, ${state.summary.uncategorized} uncategorized.`,
        progress: null,
        prepareVisible: false,
        cancelVisible: false,
        runAgainVisible: true,
        editVisible: true,
      };
    case "unavailable":
      return {
        heading: "Classifier unavailable",
        message: state.message,
        progress: null,
        prepareVisible: false,
        cancelVisible: false,
        runAgainVisible: false,
        editVisible: true,
      };
    case "configuration-error":
      return {
        heading: "Configuration error",
        message: state.message,
        progress: null,
        prepareVisible: false,
        cancelVisible: false,
        runAgainVisible: false,
        editVisible: true,
      };
    case "cancelled":
      return {
        heading: "Grouping cancelled",
        message: "No further tabs will be changed.",
        progress: null,
        prepareVisible: false,
        cancelVisible: false,
        runAgainVisible: true,
        editVisible: true,
      };
    case "error":
      return {
        heading: "Grouping failed",
        message: state.message,
        progress: null,
        prepareVisible: false,
        cancelVisible: false,
        runAgainVisible: true,
        editVisible: true,
      };
  }
}
