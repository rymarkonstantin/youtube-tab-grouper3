import { describe, expect, it } from "vitest";
import { createDefaultClassifierConfig } from "../../src/classifier/config";
import { classifierSettingsView } from "../../src/options/classifier-state";
import {
  classificationProgressView,
  diagnosticsCopyView,
  providerStatusView,
} from "../../src/sidepanel/provider-state";

describe("classifier settings view", () => {
  it("keeps remote fallback unavailable in local-only mode", () => {
    const config = createDefaultClassifierConfig();
    config.mode = "local-only";
    config.remote = {
      enabled: true,
      endpoint: "https://api.example.test/v1",
      model: "remote-model",
      apiKey: "secret",
    };

    expect(classifierSettingsView(config, true)).toMatchObject({
      remoteCanBeUsed: false,
      remoteNeedsPermission: false,
      remoteMessage: "Remote fallback is disabled while Local only is selected.",
    });
  });

  it("requires an explicit remote opt-in before remote metadata can be sent", () => {
    const view = classifierSettingsView(createDefaultClassifierConfig(), false);

    expect(view).toMatchObject({
      remoteCanBeUsed: false,
      remoteNeedsPermission: false,
      remoteMessage: "Remote fallback is disabled. No metadata will be sent remotely.",
    });
  });

  it("explains that remote-only mode needs an enabled remote provider", () => {
    const config = createDefaultClassifierConfig();
    config.mode = "remote-only";

    expect(classifierSettingsView(config, false)).toMatchObject({
      remoteCanBeUsed: false,
      remoteNeedsPermission: false,
      remoteMessage: "Enable remote classification before using Remote only.",
    });
  });

  it("reports missing remote credentials without exposing entered values", () => {
    const config = createDefaultClassifierConfig();
    config.remote = {
      enabled: true,
      endpoint: "https://api.example.test/v1",
      model: "remote-model",
      apiKey: "",
    };

    expect(classifierSettingsView(config, false)).toMatchObject({
      remoteCanBeUsed: false,
      remoteNeedsPermission: false,
      remoteMessage: "Enter a remote endpoint, model, and API key before enabling fallback.",
    });
  });
});

describe("provider side-panel state", () => {
  it("shows selected provider and a safe fallback message", () => {
    expect(
      providerStatusView({ kind: "selected", providerId: "ollama", model: "qwen2.5:3b-instruct" }),
    ).toMatchObject({
      tone: "neutral",
      message: "Using local Ollama model qwen2.5:3b-instruct.",
    });
    expect(providerStatusView({ kind: "fallback", from: "ollama", to: "remote" })).toMatchObject({
      tone: "warning",
      message: "Local Ollama is unavailable; trying the configured remote fallback.",
    });
  });

  it("gives local model setup guidance without displaying provider errors", () => {
    expect(
      providerStatusView({ kind: "ollama-unavailable", model: "qwen2.5:3b-instruct" }),
    ).toMatchObject({
      tone: "warning",
      message: "Ollama is unavailable. Start Ollama, then run: ollama pull qwen2.5:3b-instruct",
    });
  });

  it("only enables diagnostics copying when an opted-in run has a report", () => {
    expect(diagnosticsCopyView(false, true)).toEqual({ visible: false, enabled: false });
    expect(diagnosticsCopyView(true, false)).toEqual({ visible: true, enabled: false });
    expect(diagnosticsCopyView(true, true)).toEqual({ visible: true, enabled: true });
  });

  it("renders only aggregate batch progress", () => {
    expect(
      classificationProgressView({
        configuredConcurrency: 3,
        startedBatchCount: 4,
        completedBatchCount: 3,
        completedItemCount: 10,
        splitCount: 1,
        recoveredItemCount: 2,
        failedItemCount: 1,
      }),
    ).toEqual("Batches 3/4; items 10; concurrency 3; splits 1; recovered 2; failed items 1.");
  });
});
