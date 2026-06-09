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

-- =====================================================================
-- P3 (Feature 5: EV/value + odds ingest + calibration). Source: docs/P3-spec.md §3.
-- =====================================================================

-- 3.1 賠率快照：append-only；「賠率真的變動才存一列」由 code 以「價格 vs 最新」判定
--     （insert_odds_snapshots_dedup）。⚠️ last_update 會空轉（同價格也更新，實測 2026-06-09）→
--     只當 provenance，不可當去重鍵。
create table odds_snapshots (
  snapshot_id   bigserial primary key,
  match_id      text not null references matches(match_id),
  bookmaker     text not null,                 -- 'pinnacle' | 'draftkings' | ...
  market        text not null,                 -- 'h2h' | 'totals'
  outcome       text not null,                 -- 'home'|'draw'|'away'|'over'|'under'（我方定向）
  point         numeric,                        -- totals 才有（如 2.25）；h2h null
  decimal_odds  numeric not null check (decimal_odds > 1.0),
  last_update   timestamptz not null,           -- The Odds API last_update（provenance；同價格也會更新）
  captured_at   timestamptz not null            -- 我方 poll 批次時戳（provenance）
);

-- backstop index（防同 (key,last_update) 重複）。真正的 store-on-change 在 code 以價格比對。
create unique index odds_snapshots_change_uniq
  on odds_snapshots (match_id, bookmaker, market, outcome, coalesce(point, -1), last_update);

create index odds_snapshots_lookup on odds_snapshots (match_id, market, bookmaker, outcome);

-- 3.2 收盤線 view：每 (match,bookmaker,market,outcome[,point]) 在 kickoff 前 captured_at 最新一筆
create view odds_closing as
select distinct on (match_id, bookmaker, market, outcome, coalesce(point, -1))
       s.match_id, s.bookmaker, s.market, s.outcome, s.point,
       s.decimal_odds, s.last_update, s.captured_at
from odds_snapshots s
join matches m using (match_id)
where s.captured_at <= m.kickoff_utc
order by s.match_id, s.bookmaker, s.market, s.outcome, coalesce(s.point, -1), s.captured_at desc;

-- 3.3 模型在「Pinnacle 實際 totals 線」的機率（衍生；由 lambda_home/away 重算，非固定 p_over_2_5）
create table model_total_lines (
  match_id      text not null references matches(match_id),
  point         numeric not null,              -- = Pinnacle 該場當前主線
  model_version text not null,                 -- = 'dc-v1.0'
  model_p_over  numeric not null,
  model_p_under numeric not null,
  computed_at   timestamptz not null default now(),
  primary key (match_id, point, model_version)
);

-- =====================================================================
-- P2 (Feature 4: Monte Carlo group-stage advancement simulation).
-- Source: docs/P2-spec.md §2.
-- ⚠️ Apply this DDL in Supabase SQL editor BEFORE running
--    `python -m etl.simulate` (same flow as P3 objects above).
-- =====================================================================

create table group_sim (
  team_id         text not null references teams(team_id),
  group_label     char(1) not null,               -- 'A'..'L'（denormalize，省 join）
  p_first         numeric not null,               -- P(小組第一)
  p_second        numeric not null,               -- P(小組第二)
  p_third_qual    numeric not null,               -- P(最佳第三名晉級)
  p_advance       numeric not null,               -- = p_first + p_second + p_third_qual
  sim_n           int not null,                    -- 模擬次數 N（provenance）
  model_version   text not null,                   -- = 'dc-v1.0'（對齊 match_predictions）
  computed_at     timestamptz not null default now(),
  primary key (team_id, model_version)
);
