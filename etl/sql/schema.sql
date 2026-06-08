-- World Cup 2026 Analytics — Supabase / Postgres schema (P0 + P1)
-- Source of truth: docs/P0-P1-spec.md §3. Keep this file in sync with the spec.
-- Apply via Supabase SQL editor or psql.

-- 3.1 國家隊
create table teams (
  team_id        text primary key,          -- = eloratings country_code（兩碼，如 'EN'/'KR'/'BR'）；內部 join key
  name_en        text not null,
  name_zh        text,                       -- zh-TW 顯示名（i18n）；用「策展查表」非機器翻譯
  confederation  text,                       -- UEFA / CONMEBOL / CONCACAF / ...
  elo            numeric not null,           -- 賽前 Elo snapshot
  elo_asof       date    not null,           -- snapshot 日期（provenance）
  group_label    char(1)                     -- 'A'..'L'
);

-- 3.2 隊名別名（identity mapping）
create table team_aliases (
  alias    text primary key,                 -- 原始來源拼法，如 'United States'
  team_id  text not null references teams(team_id),
  source   text                              -- 'elo' | 'odds_api' | 'fixtures'（除錯用）
);

-- 3.3 賽程
create table matches (
  match_id     text primary key,             -- 來自 fixtures source 的穩定 id
  stage        text not null,                -- 'group' | 'r32' | 'r16' | 'qf' | 'sf' | 'final'
  group_label  char(1),                      -- group 賽填 'A'..'L'，淘汰賽 null
  home_team    text not null references teams(team_id),
  away_team    text not null references teams(team_id),
  kickoff_utc  timestamptz not null,
  venue        text,
  is_host_home boolean not null default false,-- home_team 是地主國且在本國比賽時 = true（主場優勢開關）
  status       text not null default 'scheduled', -- 'scheduled' | 'live' | 'final'
  home_goals   int,
  away_goals   int
);

-- 3.4 模型輸出（每 (match, model_version) 一列）
create table match_predictions (
  match_id        text not null references matches(match_id),
  model_version   text not null,             -- 如 'dc-v1.0'
  lambda_home     numeric not null,          -- 期望主隊進球
  lambda_away     numeric not null,
  p_home          numeric not null,          -- 1X2
  p_draw          numeric not null,
  p_away          numeric not null,
  p_over_2_5      numeric not null,          -- 大小分（總進球 >= 3）
  p_btts          numeric,                   -- both teams to score（matrix 免費附帶）
  exp_total_goals numeric not null,
  computed_at     timestamptz not null default now(),
  primary key (match_id, model_version)
);
