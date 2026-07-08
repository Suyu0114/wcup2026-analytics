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
  stage        text not null,                -- 'group' | 'r32' | 'r16' | 'qf' | 'sf' | '3rd' | 'final'（'3rd'＝季軍戰，對齊 sources/fixture_source.STAGE_MAP）
  group_label  char(1),                      -- group 賽填 'A'..'L'，淘汰賽 null
  home_team    text not null references teams(team_id),
  away_team    text not null references teams(team_id),
  kickoff_utc  timestamptz not null,
  venue        text,
  is_host_home boolean not null default false,-- home_team 是地主國且在本國比賽時 = true（主場優勢開關）
  is_host_away boolean not null default false,-- P6 A1：away_team 是地主國且在本國比賽（fd 第三輪把地主列客隊）
  status       text not null default 'scheduled', -- 'scheduled' | 'live' | 'final'
  home_goals   int,
  away_goals   int,
  match_no     int unique check (match_no between 73 and 104), -- P17：FIFA 場次編號（engine/bracket.py slot key）；group 為 null；由 kickoff 排程解析（etl/venues.py）
  winner       text check (winner in ('home','away')),          -- P17：fd score.winner；PK 決勝 fullTime 平分，勝者只能靠這欄或下一輪反推
  result_duration text check (result_duration in ('regular','et','pk')) -- P17：fd score.duration；'et'/'pk' ＝ 90 分鐘平手（calibrate 記 draw）
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

-- 3.3 模型 totals 機率（衍生；由 lambda_home/away 重算，非固定 p_over_2_5）
--     P6 §3.4 起為「線格」：1.5–4.5（0.25 步距）+ Pinnacle 主線；含 push 欄。
create table model_total_lines (
  match_id      text not null references matches(match_id),
  point         numeric not null,              -- 線格 1.5–4.5 + Pinnacle 主線
  model_version text not null,                 -- 如 'dc-v1.1'
  model_p_over  numeric not null,
  model_p_under numeric not null,
  model_p_push  numeric not null default 0,    -- P(total == point)；整數線才非 0（P6 §3.4）
  computed_at   timestamptz not null default now(),
  primary key (match_id, point, model_version)
);

-- =====================================================================
-- P6 (docs/P6-spec.md §4): calibration runs（Kelly 解鎖閘 + 模型模式校正狀態列）
-- =====================================================================

-- 4.2 校正結果落表：etl.calibrate 每次執行 append 一列（含 n=0，前端顯示進度 0/30）
create table calibration_runs (
  run_id         bigserial primary key,
  run_at         timestamptz not null default now(),
  model_version  text not null,
  n_settled      int not null,
  model_brier    numeric,           -- n=0 時 null
  model_logloss  numeric,
  market_brier   numeric,
  market_logloss numeric
);
create index calibration_runs_lookup on calibration_runs (model_version, run_at desc);

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

-- =====================================================================
-- P7 (admin matchday entry): manual match-result overrides. Migration: p7.sql.
-- AUTHORITATIVE hand-verified result source (fd matchday data is unreliable on the
-- free tier). The admin page upserts here; etl/ingest_fixtures.py reads it DB-first
-- (code dict etl/results.py is a fallback seed). One curated result per match.
-- P12: override_fd flag — curated score wins over a *conflicting non-null* fd score
-- when fd is plain wrong (default false keeps fail-loud-on-conflict everywhere else).
-- =====================================================================
create table manual_results (
  match_id    text primary key references matches(match_id),
  home_goals  int not null,
  away_goals  int not null,
  entered_by  text,                              -- admin identifier (provenance/audit)
  entered_at  timestamptz not null default now(),
  note        text,
  override_fd boolean not null default false      -- P12: curated wins over conflicting fd score
);

-- =====================================================================
-- P8 (FIFA-style group standings): actual table computed from finished group
-- matches. Migration: p8.sql. NOT a model output — it's a FACT derived from
-- results, so NO model_version (one canonical row per team). Recomputed by
-- etl/standings.py in the matchday recompute pipeline. Rank tiebreaker is the
-- DISPLAY one: Pts→GD→GF→H2H, then `tied=true` (no Elo/lots; see engine/standings.py).
-- =====================================================================
create table group_standings (
  team_id      text primary key references teams(team_id),
  group_label  char(1) not null,                   -- 'A'..'L'
  played       int not null default 0,
  wins         int not null default 0,
  draws        int not null default 0,
  losses       int not null default 0,
  gf           int not null default 0,             -- goals for
  ga           int not null default 0,             -- goals against
  gd           int not null default 0,             -- = gf - ga (denormalized for ordering)
  pts          int not null default 0,
  rank         int not null,                        -- 1-based position within group
  tied         boolean not null default false,      -- unresolved level with an adjacent team
  computed_at  timestamptz not null default now()   -- provenance
);
create index group_standings_group on group_standings (group_label, rank);


-- =====================================================================
-- P11 (qualification scenario analysis): for every not-yet-final group match,
-- what each of W/D/L does to the two teams' qualification status. Migration:
-- p11.sql. A deterministic FACT (no model, no Elo, no randomness — cf.
-- group_standings) → NO model_version. Cross-group best-third safety is NOT
-- decided here (v1-lean, spec §6); such teams stay `alive`/needs_best_third and
-- the frontend overlays the separate, experimental group_sim probability.
-- Grain = (match_id, outcome, team_id). Match-level flags denormalized per row.
-- Recomputed by etl/scenarios.py (full delete-all + insert) after etl/standings.py;
-- the table never holds a final match's rows (spec §8.2).
-- =====================================================================
create table group_scenarios (
  match_id              text not null references matches(match_id),
  group_label           char(1) not null,            -- 'A'..'L'
  outcome               text not null,               -- 'home' | 'draw' | 'away'
  team_id               text not null references teams(team_id),
  status                text not null,               -- top2_clinched | advance_clinched | eliminated | alive
  can_win_group         boolean not null,
  secured_3rd_or_better boolean not null,
  needs_best_third      boolean not null,
  seeding_live          boolean not null,            -- clinched top-2 but 1st-vs-2nd not pinned
  basis_key             text not null,               -- structured i18n key (translated in the frontend)
  convenience_draw      boolean not null,            -- match-level: draw locks both into top-2
  convenience_draw_kind text,                         -- 'top2' | 'mutual_3rd_conditional' | null
  dead_rubber           boolean not null,            -- match-level: result changes nothing
  computed_at           timestamptz not null default now()
);
create index group_scenarios_group on group_scenarios (group_label);
alter table group_scenarios add primary key (match_id, outcome, team_id);


-- =====================================================================
-- P14 (full-tournament knockout Monte Carlo): group → R32 (faithful FIFA Annex C,
-- engine/data/annex_c.json) → single-elimination (neutral-site, no-draw win
-- expectancy). MODEL outputs (have model_version; experimental). Migration: p14.sql.
-- Knockout outrights aren't in the odds ingest → no market to pair with (trap #7
-- exception, same as P11). Recomputed per version per round by etl/knockout_sim.py.
-- =====================================================================
create table knockout_sim (
  team_id        text not null references teams(team_id),
  group_label    char(1) not null,
  p_make_r16     numeric not null,                   -- reach R16 (won R32); "reach R32" = group_sim.p_advance
  p_make_qf      numeric not null,
  p_make_sf      numeric not null,
  p_make_final   numeric not null,
  p_champion     numeric not null,
  sim_n          int not null,
  model_version  text not null,
  computed_at    timestamptz not null default now(),
  primary key (team_id, model_version)
);

-- Projected matchups: P(team fills a given R32 slot position). Replaced per version
-- each run (delete-by-version + insert) so no stale occupant lingers.
create table bracket_slot_sim (
  match_no       int not null,                       -- FIFA R32 match number (73..88)
  side           text not null,                      -- 'home' | 'away'
  team_id        text not null references teams(team_id),
  prob           numeric not null,
  sim_n          int not null,
  model_version  text not null,
  computed_at    timestamptz not null default now(),
  primary key (match_no, side, team_id, model_version)
);
create index bracket_slot_sim_lookup on bracket_slot_sim (model_version, match_no, side);
