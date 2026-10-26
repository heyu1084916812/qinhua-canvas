import type { RunPlan, RunTask } from "../shared/execution/plan";
import type { RunRecordScope } from "../shared/execution/runRecord";

export type StoryboardRunAction =
  | "asset-base"
  | "asset-turnaround"
  | "shot-image"
  | "shot-video"
  | "speech"
  | "digital-human"
  | "video-upscale"
  | "video-fps"
  | "video-erase"
  | "video-edit"
  | "video-extend";

export type StoryboardRunSubjectKind =
  | "asset"
  | "shot-image"
  | "shot-video"
  | "speech"
  | "digital-human"
  | "video-postprocess";

interface StoryboardRunSubjectBase {
  /** Stable business handle, for example `shot:<id>` or `line:<id>`. */
  id: string;
  /** Business scope, for example `project:<id>` or `episode:<id>`. */
  scopeId: string;
}

export type StoryboardRunSubject =
  | (StoryboardRunSubjectBase & {
      kind: "asset";
      assetId: string;
      assetType: "char" | "scene";
    })
  | (StoryboardRunSubjectBase & {
      kind: "shot-image" | "shot-video" | "digital-human" | "video-postprocess";
      episodeId: string;
      shotId: string;
    })
  | (StoryboardRunSubjectBase & {
      kind: "speech";
      episodeId: string;
      shotId: string;
      lineId: string;
    });

/**
 * Storyboard execution uses the shared `nodeId` field as a neutral execution
 * subject. For storyboard work it always equals `subject.id`; it is not a
 * canvas node id.
 */
export interface StoryboardRunTask extends RunTask {
  planId: string;
  workbench: "storyboard";
  operationId: string;
  parentRunId?: string;
  action: StoryboardRunAction;
  subject: StoryboardRunSubject;
}

export interface StoryboardRunPlan extends RunPlan<StoryboardRunTask> {
  workbench: "storyboard";
}

const ACTION_SUBJECT_KIND = {
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
} as const satisfies Record<StoryboardRunAction, StoryboardRunSubjectKind>;

export function subjectKindOfAction(
  action: "asset-base" | "asset-turnaround",
): "asset";
export function subjectKindOfAction(
  action: "shot-image" | "shot-video",
): "shot-image" | "shot-video";
export function subjectKindOfAction(action: "speech"): "speech";
export function subjectKindOfAction(action: "digital-human"): "digital-human";
export function subjectKindOfAction(
  action:
    | "video-upscale"
    | "video-fps"
    | "video-erase"
    | "video-edit"
    | "video-extend",
): "video-postprocess";
export function subjectKindOfAction(
  action: StoryboardRunAction,
): StoryboardRunSubjectKind;
export function subjectKindOfAction(
  action: StoryboardRunAction,
): StoryboardRunSubjectKind {
  return ACTION_SUBJECT_KIND[action];
}

export function storyboardRunRecordScopeOfTask(
  task: Pick<StoryboardRunTask, "operationId" | "parentRunId" | "subject">,
): RunRecordScope {
  return {
    scopeVersion: 1,
    workbench: "storyboard",
    subjectId: task.subject.id,
    scopeId: task.subject.scopeId,
    operationId: task.operationId,
    ...(task.parentRunId ? { parentRunId: task.parentRunId } : {}),
  };
}

function requireNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Storyboard run task is missing ${label}`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireParam(
  params: Record<string, unknown>,
  field: string,
  expected: string,
): void {
  if (params[field] !== expected) {
    throw new Error(
      `Storyboard run params.${field} must equal subject.${field}`,
    );
  }
}

export function assertStoryboardRunTask(
  task: StoryboardRunTask,
): StoryboardRunTask {
  const planId = requireNonEmptyString(task.planId, "planId");
  const taskId = requireNonEmptyString(task.id, "task id");
  requireNonEmptyString(task.operationId, "operationId");
  if (task.parentRunId !== undefined) {
    requireNonEmptyString(task.parentRunId, "parentRunId");
  }
  const nodeId = requireNonEmptyString(task.nodeId, "nodeId");

  const subject: unknown = task.subject;
  if (!isRecord(subject)) {
    throw new Error("Storyboard run task is missing a business subject");
  }
  const subjectId = requireNonEmptyString(subject.id, "subject id");
  requireNonEmptyString(subject.scopeId, "subject scopeId");

  const expectedKind = subjectKindOfAction(task.action);
  if (subject.kind !== expectedKind) {
    throw new Error(
      `Storyboard action ${task.action} requires a ${expectedKind} subject`,
    );
  }

  const params = task.params;
  if (!isRecord(params)) {
    throw new Error("Storyboard run task is missing params");
  }
  if (params.action !== task.action) {
    throw new Error("Storyboard run params.action must equal task.action");
  }

  switch (subject.kind) {
    case "asset": {
      if (subject.assetType !== "char" && subject.assetType !== "scene") {
        throw new Error("Storyboard asset subject is missing assetType");
      }
      const assetId = requireNonEmptyString(
        subject.assetId,
        "subject assetId",
      );
      if (task.action === "asset-turnaround" && subject.assetType !== "char") {
        throw new Error("asset-turnaround only supports char assets");
      }
      requireParam(params, "assetId", assetId);
      requireParam(params, "assetType", subject.assetType);
      break;
    }
    case "shot-image":
    case "shot-video":
    case "digital-human":
    case "video-postprocess": {
      const episodeId = requireNonEmptyString(
        subject.episodeId,
        "subject episodeId",
      );
      const shotId = requireNonEmptyString(subject.shotId, "subject shotId");
      requireParam(params, "episodeId", episodeId);
      requireParam(params, "shotId", shotId);
      break;
    }
    case "speech": {
      const episodeId = requireNonEmptyString(
        subject.episodeId,
        "subject episodeId",
      );
      const shotId = requireNonEmptyString(subject.shotId, "subject shotId");
      const lineId = requireNonEmptyString(subject.lineId, "subject lineId");
      requireParam(params, "episodeId", episodeId);
      requireParam(params, "shotId", shotId);
      requireParam(params, "lineId", lineId);
      break;
    }
  }

  if (nodeId !== subjectId) {
    throw new Error("Storyboard task nodeId must equal subject.id");
  }

  const expectedTaskId = `${planId}:${task.action}:${subjectId}`;
  if (taskId !== expectedTaskId) {
    throw new Error(
      `Storyboard task id must be the stable id ${expectedTaskId}`,
    );
  }

  // Keep the assertion's successful return shape intentionally unchanged.
  return task;
}
