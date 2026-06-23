-- ===================================================================
-- AI 视频工作台 · 数据库 DDL (PostgreSQL)
-- 与 PRD「数据模型」及 types.ts 对齐。
-- 主链路: project -> brief -> script -> scene_node -> shot -> prompt
--                                                  -> gen_task -> media
-- 资产库: character / scene / generic_asset
-- 后期(P1): timeline -> track -> clip
-- ===================================================================

-- ---------- 枚举 ----------
CREATE TYPE project_status AS ENUM
  ('drafting','scripting','generating','editing','done','archived');
CREATE TYPE task_status    AS ENUM
  ('queued','running','done','failed','canceled');
CREATE TYPE asset_state    AS ENUM
  ('pending','generating','done','failed');
CREATE TYPE gen_kind       AS ENUM
  ('char_ref','keyframe','fx','video','voice','bgm');
CREATE TYPE fx_intensity   AS ENUM ('low','mid','high');
CREATE TYPE track_kind     AS ENUM ('video','audio','voice','sub');
CREATE TYPE clip_type      AS ENUM ('video','trans','audio','voice','sub');

-- ---------- 项目 ----------
CREATE TABLE project (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  status      project_status NOT NULL DEFAULT 'drafting',
  duration_s  INTEGER NOT NULL DEFAULT 0,
  aspect      TEXT    NOT NULL DEFAULT '16:9',
  lang        TEXT    NOT NULL DEFAULT 'zh',
  style       TEXT    NOT NULL DEFAULT '',
  owner_id    TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- 需求单 ----------
CREATE TABLE brief (
  project_id   TEXT PRIMARY KEY REFERENCES project(id) ON DELETE CASCADE,
  completeness SMALLINT NOT NULL DEFAULT 0 CHECK (completeness BETWEEN 0 AND 100)
);

CREATE TABLE brief_field (
  id         BIGSERIAL PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES brief(project_id) ON DELETE CASCADE,
  k          TEXT NOT NULL,
  v          TEXT NOT NULL DEFAULT '',
  done       BOOLEAN NOT NULL DEFAULT false,
  ord        INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_brief_field_project ON brief_field(project_id);

-- ---------- 对话 ----------
CREATE TABLE dialogue_message (
  id         BIGSERIAL PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  role       TEXT NOT NULL CHECK (role IN ('ai','me')),
  text       TEXT NOT NULL,
  chips      JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_dialogue_project ON dialogue_message(project_id, created_at);

-- ---------- 资产库: 角色 / 场景 / 通用 ----------
CREATE TABLE character (
  id         TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  locked     BOOLEAN NOT NULL DEFAULT false,
  version    INTEGER NOT NULL DEFAULT 1,
  voice      TEXT NOT NULL DEFAULT '',
  descr      TEXT NOT NULL DEFAULT '',
  img        TEXT
);
CREATE INDEX idx_character_project ON character(project_id);

-- 角色关系（人物关系图）
CREATE TABLE character_relation (
  id          BIGSERIAL PRIMARY KEY,
  character_id TEXT NOT NULL REFERENCES character(id) ON DELETE CASCADE,
  target_id    TEXT NOT NULL REFERENCES character(id) ON DELETE CASCADE,
  rel_type     TEXT NOT NULL,
  UNIQUE (character_id, target_id)
);

CREATE TABLE scene (
  id         TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  descr      TEXT NOT NULL DEFAULT '',
  img        TEXT
);
CREATE INDEX idx_scene_project ON scene(project_id);

CREATE TABLE generic_asset (
  id         TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  descr      TEXT NOT NULL DEFAULT '',
  asset_type TEXT NOT NULL DEFAULT 'other'
);
CREATE INDEX idx_generic_project ON generic_asset(project_id);

-- ---------- 脚本: 全局 + 分幕 + 分镜 ----------
CREATE TABLE script (
  project_id  TEXT PRIMARY KEY REFERENCES project(id) ON DELETE CASCADE,
  total_scenes INTEGER NOT NULL DEFAULT 0,
  duration_s   INTEGER NOT NULL DEFAULT 0,
  style        TEXT NOT NULL DEFAULT '',
  bgm          TEXT NOT NULL DEFAULT '',
  narration    TEXT NOT NULL DEFAULT ''
);

-- 一「幕」
CREATE TABLE scene_node (
  id            TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  ord           INTEGER NOT NULL,
  title         TEXT NOT NULL,
  goal          TEXT NOT NULL DEFAULT '',
  scene_ref_id  TEXT REFERENCES scene(id) ON DELETE SET NULL,
  fx_need       BOOLEAN NOT NULL DEFAULT false,
  fx_type       TEXT NOT NULL DEFAULT '',
  fx_intensity  fx_intensity,
  narration     TEXT NOT NULL DEFAULT '',
  kf_state      asset_state NOT NULL DEFAULT 'pending',
  kf_media_id   TEXT,
  UNIQUE (project_id, ord)
);
CREATE INDEX idx_scene_node_project ON scene_node(project_id, ord);

-- 幕 <-> 角色（出场）多对多
CREATE TABLE scene_node_char (
  scene_node_id TEXT NOT NULL REFERENCES scene_node(id) ON DELETE CASCADE,
  character_id  TEXT NOT NULL REFERENCES character(id) ON DELETE CASCADE,
  PRIMARY KEY (scene_node_id, character_id)
);

-- 分镜（一幕内的镜头单元）
CREATE TABLE shot (
  id            TEXT PRIMARY KEY,
  scene_node_id TEXT NOT NULL REFERENCES scene_node(id) ON DELETE CASCADE,
  ord           INTEGER NOT NULL,
  shot_size     TEXT,
  camera        TEXT,
  duration_s    INTEGER,
  media_id      TEXT,
  UNIQUE (scene_node_id, ord)
);
CREATE INDEX idx_shot_scene_node ON shot(scene_node_id, ord);

-- Prompt（挂在幕或分镜上，可单独重生）
CREATE TABLE prompt (
  id            BIGSERIAL PRIMARY KEY,
  scene_node_id TEXT REFERENCES scene_node(id) ON DELETE CASCADE,
  shot_id       TEXT REFERENCES shot(id) ON DELETE CASCADE,
  kind          gen_kind NOT NULL,
  label         TEXT NOT NULL,
  hint          TEXT,
  text          TEXT NOT NULL,
  version       INTEGER NOT NULL DEFAULT 1,
  CHECK (scene_node_id IS NOT NULL OR shot_id IS NOT NULL)
);
CREATE INDEX idx_prompt_scene_node ON prompt(scene_node_id);
CREATE INDEX idx_prompt_shot ON prompt(shot_id);

-- ---------- 生成任务 / 产物 ----------
CREATE TABLE media (
  id         TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  kind       gen_kind NOT NULL,
  url        TEXT NOT NULL,
  mime       TEXT,
  width      INTEGER,
  height     INTEGER,
  duration_s INTEGER,
  has_alpha  BOOLEAN NOT NULL DEFAULT false,
  version    INTEGER NOT NULL DEFAULT 1,
  task_id    TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_media_project ON media(project_id);

CREATE TABLE gen_task (
  id         TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  kind       gen_kind,
  title      TEXT NOT NULL,
  sub        TEXT NOT NULL DEFAULT '',
  status     task_status NOT NULL DEFAULT 'queued',
  progress   SMALLINT NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  thumb      TEXT,
  ref_id     TEXT,            -- 关联 scene_node / shot / character
  media_id   TEXT REFERENCES media(id) ON DELETE SET NULL,
  error      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_gen_task_project ON gen_task(project_id, status);

-- 补建 media.task_id -> gen_task 的外键（循环引用，延后添加）
ALTER TABLE media
  ADD CONSTRAINT fk_media_task
  FOREIGN KEY (task_id) REFERENCES gen_task(id) ON DELETE SET NULL;

-- ---------- 时间轴 / 剪辑 (P1) ----------
CREATE TABLE timeline (
  project_id TEXT PRIMARY KEY REFERENCES project(id) ON DELETE CASCADE
);

CREATE TABLE track (
  id         BIGSERIAL PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES timeline(project_id) ON DELETE CASCADE,
  kind       track_kind NOT NULL,
  ord        INTEGER NOT NULL DEFAULT 0,
  UNIQUE (project_id, kind)
);

CREATE TABLE clip (
  id         BIGSERIAL PRIMARY KEY,
  track_id   BIGINT NOT NULL REFERENCES track(id) ON DELETE CASCADE,
  clip_type  clip_type NOT NULL,
  label      TEXT NOT NULL DEFAULT '',
  w          INTEGER NOT NULL DEFAULT 0,  -- 原型: 时间轴宽度(px) / 实际: 可换为 duration_s
  ml         INTEGER NOT NULL DEFAULT 0,  -- 左侧偏移(px)
  media_id   TEXT REFERENCES media(id) ON DELETE SET NULL,
  ord        INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_clip_track ON clip(track_id, ord);

-- ---------- 自动更新 updated_at ----------
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_project_touch  BEFORE UPDATE ON project
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER trg_gen_task_touch BEFORE UPDATE ON gen_task
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
