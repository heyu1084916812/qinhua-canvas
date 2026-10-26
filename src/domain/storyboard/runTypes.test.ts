import { describe, expect, it } from "vitest";
import {
  assertStoryboardRunTask,
  storyboardRunRecordScopeOfTask,
  subjectKindOfAction,
  type StoryboardRunAction,
  type StoryboardRunSubject,
  type StoryboardRunSubjectKind,
  type StoryboardRunTask,
} from "./runTypes";

const ACTIONS = [
  "asset-base",
  "asset-turnaround",
  "shot-image",
  "shot-video",
  "speech",
  "digital-human",
  "video-upscale",
  "video-fps",
  "video-erase",
  "video-edit",
  "video-extend",
] as const satisfies readonly StoryboardRunAction[];

const EXPECTED_KIND: Record<StoryboardRunAction, StoryboardRunSubjectKind> = {
  "asset-base": "asset",
  "asset-turnaround": "asset",
  "shot-image": "shot-image",
  "shot-video": "shot-video",
  speech: "speech",
  "digital-human": "digital-human",
  "video-upscale": "video-postprocess",
  "video-fps": "video-postprocess",
  "video-erase": "video-postprocess",
  "video-edit": "video-postprocess",
  "video-extend": "video-postprocess",
};

function subjectFor(action: StoryboardRunAction): StoryboardRunSubject {
  if (action === "asset-base" || action === "asset-turnaround") {
    const suffix = action === "asset-base" ? "base" : "turnaround";
    return {
      kind: "asset",
      id: `char:char-1:${suffix}`,
      scopeId: "project:project-1",
      assetId: "char-1",
      assetType: "char",
    };
  }
  if (action === "speech") {
    return {
      kind: "speech",
      id: "line:line-1",
      scopeId: "episode:episode-1",
      episodeId: "episode-1",
      shotId: "shot-1",
      lineId: "line-1",
    };
  }
  return {
    kind:
      action === "shot-image" ||
      action === "shot-video" ||
      action === "digital-human"
        ? action
        : "video-postprocess",
    id: "shot:shot-1",
    scopeId: "episode:episode-1",
    episodeId: "episode-1",
    shotId: "shot-1",
  };
}

function paramsFor(
  action: StoryboardRunAction,
  subject: StoryboardRunSubject,
): Record<string, unknown> {
  if (subject.kind === "asset") {
    return {
      action,
      assetType: subject.assetType,
      assetId: "char-1",
    };
  }
  if (subject.kind === "speech") {
    return {
      action,
      episodeId: subject.episodeId,
      shotId: subject.shotId,
      lineId: subject.lineId,
    };
  }
  return {
    action,
    episodeId: subject.episodeId,
    shotId: subject.shotId,
  };
}

function taskFor(
  action: StoryboardRunAction,
  overrides: Partial<StoryboardRunTask> = {},
): StoryboardRunTask {
  const subject = subjectFor(action);
  return {
    id: `plan-1:${action}:${subject.id}`,
    nodeId: subject.id,
    planId: "plan-1",
    workbench: "storyboard",
    operationId: "operation-1",
    action,
    subject,
    request: {
      kind:
        action === "shot-image" || action.startsWith("asset-")
          ? "image"
          : action === "speech"
            ? "text"
            : "video",
      channelId: "channel-1",
      model: "model-1",
      prompt: "test prompt",
      inputs: [],
      params: {},
    },
    dependsOn: [],
    fingerprint: "fingerprint-1",
    params: paramsFor(action, subject),
    ...overrides,
  };
}

function taskWithSubject(
  action: StoryboardRunAction,
  subject: Record<string, unknown>,
): StoryboardRunTask {
  const base = taskFor(action);
  const subjectId = typeof subject.id === "string" ? subject.id : "subject-1";
  return {
    ...base,
    id: `plan-1:${action}:${subjectId}`,
    nodeId: subjectId,
    subject: subject as unknown as StoryboardRunSubject,
  };
}

describe("storyboard run contracts", () => {
  it("maps all eleven actions to the expected subject kind", () => {
    for (const action of ACTIONS) {
      expect(subjectKindOfAction(action)).toBe(EXPECTED_KIND[action]);
    }
  });

  it.each(ACTIONS)(
    "accepts %s with its complete action-specific subject context",
    (action) => {
      const task = taskFor(action);
      expect(assertStoryboardRunTask(task)).toBe(task);
    },
  );

  it("keeps nodeId as a neutral field equal to the stable subject id", () => {
    expect(() =>
      assertStoryboardRunTask(
        taskFor("shot-image", { nodeId: "canvas-node-1" }),
      ),
    ).toThrow("nodeId must equal subject.id");
  });

  it("rejects a subject kind that does not match the action", () => {
    const subject = subjectFor("shot-image");
    const task = taskFor("shot-video");
    expect(() =>
      assertStoryboardRunTask({
        ...task,
        subject,
        nodeId: subject.id,
        id: `plan-1:shot-video:${subject.id}`,
        params: paramsFor("shot-video", subject),
      }),
    ).toThrow("requires a shot-video subject");
  });

  it("rejects non-empty but non-stable task ids", () => {
    expect(() =>
      assertStoryboardRunTask(taskFor("shot-image", { id: "task-1" })),
    ).toThrow("stable id");
  });

  it.each([
    ["planId", { planId: "   " }],
    ["task id", { id: "" }],
    ["operationId", { operationId: "   " }],
  ])("rejects an empty %s", (label, override) => {
    expect(() =>
      assertStoryboardRunTask(taskFor("shot-image", override)),
    ).toThrow(`missing ${label}`);
  });

  it.each([
    [
      "Storyboard asset subject is missing assetType",
      "asset-base",
      {
        kind: "asset",
        id: "char:char-1:base",
        scopeId: "project:project-1",
        assetId: "char-1",
      },
    ],
    [
      "missing subject episodeId",
      "shot-image",
      {
        kind: "shot-image",
        id: "shot:shot-1",
        scopeId: "episode:episode-1",
        shotId: "shot-1",
      },
    ],
    [
      "missing subject shotId",
      "shot-video",
      {
        kind: "shot-video",
        id: "shot:shot-1",
        scopeId: "episode:episode-1",
        episodeId: "episode-1",
      },
    ],
    [
      "missing subject lineId",
      "speech",
      {
        kind: "speech",
        id: "line:line-1",
        scopeId: "episode:episode-1",
        episodeId: "episode-1",
        shotId: "shot-1",
      },
    ],
    [
      "missing subject episodeId",
      "digital-human",
      {
        kind: "digital-human",
        id: "shot:shot-1",
        scopeId: "episode:episode-1",
        shotId: "shot-1",
      },
    ],
    [
      "missing subject shotId",
      "video-edit",
      {
        kind: "video-postprocess",
        id: "shot:shot-1",
        scopeId: "episode:episode-1",
        episodeId: "episode-1",
      },
    ],
  ] as const)("rejects %s", (message, action, subject) => {
    expect(() =>
      assertStoryboardRunTask(taskWithSubject(action, subject)),
    ).toThrow(message);
  });

  it("allows char/scene asset-base but only char asset-turnaround", () => {
    expect(() => assertStoryboardRunTask(taskFor("asset-base"))).not.toThrow();
    expect(() =>
      assertStoryboardRunTask(
        taskWithSubject("asset-turnaround", {
          ...subjectFor("asset-turnaround"),
          assetType: "scene",
        }),
      ),
    ).toThrow("asset-turnaround only supports char assets");
  });

  it("persists action and subject context in params", () => {
    expect(() =>
      assertStoryboardRunTask(
        taskFor("shot-image", {
          params: {
            action: "shot-video",
            episodeId: "episode-1",
            shotId: "shot-1",
          },
        }),
      ),
    ).toThrow("params.action must equal task.action");

    expect(() =>
      assertStoryboardRunTask(
        taskFor("shot-image", {
          params: {
            action: "shot-image",
            episodeId: "episode-2",
            shotId: "shot-1",
          },
        }),
      ),
    ).toThrow("params.episodeId must equal subject.episodeId");
  });

  it("uses the business subject, scope and operation in RunRecord scope", () => {
    expect(
      storyboardRunRecordScopeOfTask({
        operationId: "operation-1",
        subject: subjectFor("shot-image"),
      }),
    ).toEqual({
      scopeVersion: 1,
      workbench: "storyboard",
      subjectId: "shot:shot-1",
      scopeId: "episode:episode-1",
      operationId: "operation-1",
    });
  });
});
