/**
 * AI 视频工作台 · 领域类型定义
 * ------------------------------------------------------------------
 * 与 PRD「数据模型」一节对齐，并兼容原型 data.js 的运行时结构。
 * 主链路：Project → Brief → Script → SceneNode → Shot → Prompt → GenTask → Media
 * 资产库：Character / Scene / GenericAsset
 * 后期（P1）：Timeline → Track → Clip
 */

/* ============ 公共枚举 / 基础类型 ============ */

export type ID = string;
export type ISODateTime = string; // RFC3339, e.g. "2026-06-18T16:42:53+08:00"

export type AspectRatio = "16:9" | "9:16" | "1:1" | "4:3";
export type Lang = "zh" | "en" | "ja";

/** 项目生命周期 */
export type ProjectStatus =
  | "drafting"     // 需求澄清中
  | "scripting"    // 脚本生成 / 编辑
  | "generating"   // 素材生成中
  | "editing"      // 后期剪辑
  | "done"         // 已完成
  | "archived";    // 已归档

/** 异步生成任务状态机：queued → running → done | failed */
export type TaskStatus = "queued" | "running" | "done" | "failed" | "canceled";

/** 关键帧 / 素材在分镜上的挂载状态 */
export type AssetState = "pending" | "generating" | "done" | "failed";

/** 三类可生成素材 */
export type GenKind =
  | "char_ref"   // 角色参考图
  | "keyframe"   // 分镜关键帧
  | "fx"         // 动效（hyperframes：动画代码 + 透明/绿幕视频）
  | "video"      // 视频片段
  | "voice"      // 旁白配音
  | "bgm";       // 背景音乐

/** 动效强度 */
export type FxIntensity = "low" | "mid" | "high";

/* ============ 项目 ============ */

export interface Project {
  id: ID;
  name: string;
  status: ProjectStatus;
  spec: ProjectSpec;
  ownerId?: ID;
  createdAt?: ISODateTime;
  updatedAt?: ISODateTime;
}

export interface ProjectSpec {
  duration_s: number;      // 目标时长（秒）
  aspect: AspectRatio;
  lang: Lang;
  style: string;           // 整体风格，如「科技商务风」
}

/* ============ 需求单（多轮对话产物） ============ */

export interface Brief {
  projectId: ID;
  completeness: number;    // 0-100，字段完备度
  fields: BriefField[];
}

export interface BriefField {
  k: string;               // 字段名，如「目标受众」
  v: string;               // 字段值（未填为空串）
  done: boolean;           // 是否已收集
}

/** 单条对话消息 */
export interface DialogueMessage {
  id?: ID;
  role: "ai" | "me";
  text: string;
  chips?: string[];        // AI 消息附带的已收集信息标签
  createdAt?: ISODateTime;
}

/* ============ 脚本 / 分幕 / 分镜 ============ */

export interface Script {
  projectId: ID;
  global: ScriptGlobal;
  scenes: SceneNode[];     // 分幕
}

export interface ScriptGlobal {
  scenes: number;          // 总幕数
  duration_s: number;
  style: string;
  bgm: string;
  narration: string;       // 旁白风格描述
}

/** 一「幕」（SceneNode）。一幕可含一个或多个分镜（Shot）。 */
export interface SceneNode {
  id: ID;
  order: number;
  title: string;
  goal: string;            // 本幕叙事目标
  sceneRef: string;        // 关联场景名称（冗余展示）
  sceneRefId: ID;          // 关联 Scene.id
  chars: SceneCharRef[];   // 出场角色引用
  fx: FxSpec;
  narration: string;       // 本幕旁白文案
  kfState: AssetState;     // 关键帧生成状态
  kf: string | null;       // 关键帧素材 URL（done 时有值）
  shots?: Shot[];          // 细分分镜（可选，PRD 完整模型）
}

export interface SceneCharRef {
  id: ID;
  name: string;
}

export interface FxSpec {
  need: boolean;
  type: string;            // 动效类型，如「数据增长动画」
  intensity: FxIntensity | string;
}

/** 分镜（Shot）：一幕内的镜头单元，承载 Prompt 与产物 */
export interface Shot {
  id: ID;
  sceneId: ID;
  order: number;
  shotSize?: string;       // 景别，如「中景」
  camera?: string;         // 运镜，如「dolly_in」
  durationS?: number;
  prompts: Prompt[];
  mediaId?: ID;            // 产出的视频片段
}

/** 可编辑、可单独重生的 Prompt */
export interface Prompt {
  id?: ID;
  kind: GenKind;
  label: string;
  hint?: string;
  text: string;
  version?: number;
}

/* ============ 资产库 ============ */

export interface Character {
  id: ID;
  name: string;
  locked: boolean;         // 形象是否已锁定（保证一致性）
  version: number;
  voice: string;
  desc: string;
  img: string | null;      // 参考图 URL
  relations?: CharacterRelation[];
}

export interface CharacterRelation {
  targetId: ID;
  type: string;            // 如「客户」「同事」
}

export interface Scene {
  id: ID;
  name: string;
  desc: string;
  img: string | null;
}

export interface GenericAsset {
  id: ID;
  name: string;
  desc: string;
  type: "logo" | "audio" | "image" | "video" | "other";
}

/* ============ 生成任务 / 产物 ============ */

export interface GenTask {
  id: ID;
  projectId?: ID;
  kind?: GenKind;
  title: string;
  sub: string;             // 副标题，如「keyframe · 现代办公室」
  status: TaskStatus;
  progress: number;        // 0-100
  thumb: string | null;
  refId?: ID;              // 关联 SceneNode / Shot / Character
  mediaId?: ID;            // 完成后产出的 Media
  error?: string;
  createdAt?: ISODateTime;
  updatedAt?: ISODateTime;
}

export interface Media {
  id: ID;
  kind: GenKind;
  url: string;
  mime?: string;
  width?: number;
  height?: number;
  durationS?: number;
  hasAlpha?: boolean;      // 透明通道（动效绿幕/透底）
  version?: number;
  taskId?: ID;
}

/* ============ 时间轴 / 剪辑（P1） ============ */

export type TrackKind = "video" | "audio" | "voice" | "sub";
export type ClipType = "video" | "trans" | "audio" | "voice" | "sub";

export interface Timeline {
  projectId: ID;
  tracks: Record<TrackKind, Clip[]>;
}

export interface Clip {
  type: ClipType;
  label: string;
  w: number;               // 时间轴宽度（px，原型用；实际可为 durationS）
  ml?: number;             // 左侧间距（px，对应空隙/偏移）
  mediaId?: ID;
}

/* ============ 运行时根对象（对应 window.DB） ============ */

export interface AppDB {
  project: Project;
  brief: Brief;
  dialogue: DialogueMessage[];
  script: Script;
  characters: Character[];
  scenes: Scene[];
  generic: GenericAsset[];
  tasks: GenTask[];
  timeline: Timeline;
}
