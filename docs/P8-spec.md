# P8 — 賽程/成績頁 + 小組積分榜頁（spec / 實作紀錄）

> 已實作。與 [P5-spec.md](P5-spec.md)（前端契約）一致；積分榜為**事實**，不碰 P1/P3 模型契約。
> 本檔記錄設計、決策與驗收；與程式碼衝突時以程式碼為準。

## 0. 背景 / 動機

P7 已導入比數（admin 手動輸入 → `manual_results` → recompute pipeline 落 `matches.home_goals/away_goals/status='final'`），但前端一直沒有把比分呈現出來：

- [web/lib/data.ts](../web/lib/data.ts) 的 `getMatches()` 連 `home_goals/away_goals` 都沒 SELECT。
- `/groups` 頁只顯示 **Monte Carlo 晉級機率**（`group_sim`），**不是實際積分榜**。
- 實際積分榜（Pts / 勝平負 / GF / GA / GD / 排名）**原本不存在任何地方**。

目標：仿 FIFA `scores-fixtures` 與 `standings`，新增 **兩個獨立頁面**呈現「每場實際比分」與「小組實際積分榜」，與 `/matches`（預測）、`/groups`（晉級機率）並存互補。

## 1. 決策（與 user 確認）

1. **兩個獨立新頁面**：`/results`（賽程與成績）+ `/standings`（小組積分榜）。現有頁面不動。
2. **新增 `group_standings` ETL 表**：由 Python 引擎在 recompute pipeline 算好寫入（單一權威來源、與模擬同引擎血統），前端只讀。
3. **同分排序 = Pts→GD→GF→H2H，剩餘仍同分則並列（`tied`）**；**不**用 Elo/隨機（非真實 FIFA 規則、會誤導）。footnote 註明公平競賽分/抽籤未模擬。

### 1.1 設計修訂（依 user 回饋）

- **R1 快取斷層**：matchday 改分後 30 分鐘 ISR 會顯示舊資料 → `/results`、`/standings` 改 `export const dynamic = 'force-dynamic'`（每次請求即時讀 DB；資料量小，對齊已 dynamic 的 `/api/value/market`）。驗證：兩 route 不在 prerender-manifest 內。
- **R2 第三名晉級**：2026 賽制 12 組 → 前 2 名（24 隊）+ 8 個最佳第三名晉級 32 強。積分榜視覺**分級**：1/2 名實線明綠左框、**第 3 名虛線/淡綠（仍可能晉級，別讓人以為被淘汰）**、第 4 名無框。
- **R3 H2H 完全循環**：排名退化情境（A>B、B>C、C>A 且三方 H2H 得失球/進球全等）必須**決定性退回字母序 + `tied=true`**，不得無限迴圈/IndexError（`_rank` 全用 `sorted()`，無遞迴）。
- **R4 淘汰賽佔位**：`getFixtures()` **撈全階段**（不過濾 `stage`），UI 用 `stage` switch；群組賽依日期分組，淘汰賽走 `KnockoutTbd` 分支（schema `home_team/away_team` NOT NULL + trap #10：未抽籤淘汰賽不在 DB，撈全階段現階段＝只有群組，但 UI 保留 TBD 分支、抽籤後自動現出）。

## 2. 範圍邊界（硬性）

**做：** `group_standings` 表 + [etl/standings.py](../etl/standings.py) job + [engine/standings.py](../engine/standings.py) 排名純函數 + 兩個前端頁面 + i18n + 導覽列。
**只算 group stage**（A–L 12 組）。
**不動：** 模型 / 預測 / 賠率 / value 算術（`value.ts`/`value.py`/golden_vectors 不碰——積分榜是事實非模型，不經校正、不帶 `model_version`）。

## 3. 資料模型

`group_standings`（[etl/sql/migrations/p8.sql](../etl/sql/migrations/p8.sql)；同步 [etl/sql/schema.sql](../etl/sql/schema.sql)）：

| 欄位 | 說明 |
|---|---|
| `team_id` (PK) | 每隊唯一一列（**無 `model_version`**；事實非模型） |
| `group_label` | 'A'..'L' |
| `played / wins / draws / losses` | 只計 `status='final'` |
| `gf / ga / gd` | `gd` 反正規化供排序 |
| `pts` | 勝 3 / 和 1 / 負 0 |
| `rank` | 1-based 組內名次 |
| `tied` | 與相鄰隊完全同分且 H2H 無法分出（footnote 用） |
| `computed_at` | provenance |

## 4. 引擎 — `engine/standings.py`（純函數）

- `compute_group_standings(team_ids, finished) -> list[StandingRow]`：累加 P/W/D/L/GF/GA/Pts（只吃傳入的 finished），建 H2H dict（規範化同 `group_sim`），呼叫 `_rank`。
- `_rank`：**Pass1** `(-pts,-gd,-gf, team_id)`；**Pass2** 對 `(pts,gd,gf)` 完全相同子集用 [group_sim](../engine/group_sim.py)`._compute_h2h_stats`（**共用 H2H 數學、不重寫**）排 `(-h2h_pts,-h2h_gd,-h2h_gf)`；仍無法分出者 → 字母序 + `tied=true`。
- **顯示用排名，刻意與 `group_sim.rank_group` 區隔**：後者尾段 `…→Elo→random` 是給蒙地卡羅強制全序用，當「實際積分榜」會誤導。
- 決定性、無隨機、無 Elo。賽前全 0 → 全 `tied`。

測試 [tests/test_standings.py](../tests/test_standings.py)：累加 / Pts→GD→GF→H2H / R3 完全循環 / 賽前全 0 / 只吃 final。

## 5. ETL — `etl/standings.py`

- 讀 `matches`（`stage='group'`），**組成員由 fixtures 推導**（不依賴 `teams.group_label`）。
- finished = `status='final'` 且 goals 非 null（**fail-loud**：final 缺 goals → raise）。
- 每組 `compute_group_standings` → upsert `group_standings`（`on_conflict=team_id`，帶 `computed_at`）。`--dry-run` 印表不寫。
- 驗證 12 組 × 4 隊、48 列（fail-loud）。
- **pipeline**：[.github/workflows/recompute.yml](../.github/workflows/recompute.yml) 在 `ingest_fixtures` 後加 `python -m etl.standings` → admin 改分自動重算。

## 6. 前端

- **data**（[web/lib/data.ts](../web/lib/data.ts)）：
  - `getFixtures()`：teams + `matches`（**全階段**，含 `stage,home_goals,away_goals,venue,status`），依 `kickoff_utc` 排序；精簡（不抓 predictions/odds）。
  - `getStandings()`：`group_standings` + teams，依 `group_label` 分組、`rank` 升冪。**不 filter `MODEL_VERSION`**。表缺（pre-migration）→ `unavailable`（graceful）。
- **頁面**（皆 `export const dynamic='force-dynamic'`，R1）：
  - [/results](../web/app/[locale]/results/page.tsx) → `ScoreFilters`（組別/狀態/搜尋，依日期分段）+ `FixtureRow`；淘汰賽 `stage` switch → `KnockoutTbd`。
  - [/standings](../web/app/[locale]/standings/page.tsx) → 12 組 `StandingsTable`（P/W/D/L/GF/GA/GD/Pts、`tied` 標 `=`、R2 分級框 + legend + tiebreak footnote）。
- **元件**：[StandingsTable.tsx](../web/components/StandingsTable.tsx) / [ScoreFilters.tsx](../web/components/ScoreFilters.tsx) / [FixtureRow.tsx](../web/components/FixtureRow.tsx)（後者 server/client 共用）。
- **導覽 + i18n**：[SiteHeader.tsx](../web/components/SiteHeader.tsx) 加 `/results`、`/standings`；`nav.results/standings` + `results.*` + `standings.*` 兩語對齊（TU1 parity）。

## 7. 陷阱對齊（沿 CLAUDE.md）

- **trap #10**：淘汰賽 null 隊 → 兩頁 group-only + `KnockoutTbd`。
- **trap #5 host_away 無關**：積分榜只看每隊 goals，不管主客定向。
- **data-integrity over approximation**：同分不掰 Elo/抽籤 → 並列 + footnote。
- **graceful 空狀態（trap #13d）**：表缺/空 → `EmptyState`，不 throw。
- **name_zh fallback（trap #14）**：`displayTeamName`；缺繁中顯示 banner。
- **積分榜非模型**：`group_standings` 無 `model_version`、`getStandings` 不 filter `MODEL_VERSION`。

## 8. 驗收

| 項 | 條件 | 狀態 |
|---|---|---|
| 引擎 | `pytest tests/test_standings.py`（排序/累加/tied/R3 循環/賽前） | ✅ 7 passed |
| migration | `etl/sql/migrations/p8.sql` 套用 | ⏳ 待在 Supabase 套 |
| ETL | `python -m etl.standings --dry-run` → 48 列 | ⏳ 套表後驗 |
| pipeline | recompute 含 standings 步 | ✅ |
| FE build | `npm run build`（含 TS） | ✅；`/results`、`/standings` 確認 dynamic（不在 prerender-manifest） |
| FE 測試 | `npm test`（i18n parity + StandingsTable 分級框/tied） | ✅ |
| 即時性（R1） | 改 `group_standings`/score → 重整即見（force-dynamic） | ✅ 機制確認 |

### 上線手動步驟
Supabase SQL editor 套 `etl/sql/migrations/p8.sql` → `python -m etl.standings --dry-run` → `python -m etl.standings`。套表前兩頁走 graceful 空狀態。

## 9. 未做（刻意）

- `getMatches()`/`/matches` 預測卡顯示終場比分（plan 列為 optional「順手」，為控制改動面暫不做）。
- 淘汰賽積分/對戰圖：抽籤後 fixtures 自然帶入，`/results` 的 `stage` 分支已預留。
