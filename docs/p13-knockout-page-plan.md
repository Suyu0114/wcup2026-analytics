# P13 — 淘汰賽頁面（`/bracket`）規劃

> 兩個 plan 之一（Page）。另一份：[docs/p14-knockout-model-plan.md](p14-knockout-model-plan.md)（Model）。
> 狀態：**規劃中、待確認、尚未實作**。

## Context

小組賽即將結束，賽事進入 **2026 新制淘汰賽（Round of 32 → Final）**。目前整個淘汰賽層是 greenfield：

- `engine/group_sim.py` 只模擬小組賽——`rank_group`（12 組）＋ `rank_third_places` 選 8 個最佳第三名後即止。**無 bracket 結構、無奪冠/晉級機率、無淘汰賽 match 預測**。
- `etl/ingest_fixtures.py` 已會 **skip 32 場 null-team 淘汰賽**（trap #10），抽籤後 fd 填上隊伍即 idempotent 補上（`matches.stage` 已支援 `r32/r16/qf/sf/3rd/final`）。
- `/results` 有 knockout 分支，但只把淘汰賽當一串 `FixtureRow`（[web/app/[locale]/results/page.tsx:49-55](../web/app/[locale]/results/page.tsx)）——**無 bracket 視覺、無預測**。

### 2026 新制關鍵差異
48 隊 / 12 組 → R32 = 各組前二（24）＋ **8 個最佳第三名**。8 個第三名分配到哪 8 個 R32 槽，取決於**是哪 8 組**產生晉級第三名，由 FIFA **Annex C 表（C(12,8)=495 組合）** 決定。
- **抽籤後的真實 bracket 由 football-data 直接給** → 本頁（P13）顯示用不到 Annex C。
- 模擬 bracket 時 matchup 未定 → 才需自己實作 Annex C（屬 P14）。

### 本 plan（P13 = Page）目標
抽籤一落地就有一頁能看的淘汰賽 bracket，含每場 model 預測 ＋ 市場並列 ＋ **single-match advance %（We）**。**不依賴 Monte Carlo**，最具時效。

4 個預測項目落點：**Single-match advance % → 本頁（P13）**；Champion / Per-round / Projected matchups → P14。

---

## A0. 前置 / ingest readiness（淘汰賽落地不能炸）

- **venues**：淘汰賽含地主國（US/CA/MX）的場次，`venues.host_flags()` 缺 venue 會 **raise**（[etl/venues.py:63-81](../etl/venues.py)）。→ 建 **slot→stadium→country 策展表**（R32–Final 各 match 場館固定），抽籤後把實際 host 淘汰賽場補進 `MANUAL_VENUE`。地主在 fd 被列客隊時走既有 `is_host_away`（對稱 −HFA），**不交換定向**（trap #5）。
- **odds 去重 collision**：`ingest_odds` 以無序隊伍對當 index，淘汰賽再遇同一對會撞（trap #12）。→ event→match 對應加 **時間/輪次** disambiguation。
- **fd 可靠性風險（本 plan 最大未知）**：memory 記錄 fd 在 matchday 會「FINISHED 但 fullTime 為 null」（亦見 P12：fd 比分有時直接錯）。若 fd 也不可靠地填淘汰賽**隊伍指派**，需要新的**手動 bracket 種子路徑**（現有 `manual_results`/admin 只處理『比分』、非『隊伍指派』）。**先驗證 fd 抽籤後是否自動填 `homeTeam/awayTeam`**；不行才補手動指派。

## A1. predict 延伸到淘汰賽（single-match advance %）

- `etl/predict.py` 無 stage filter（[etl/predict.py:54-56](../etl/predict.py)），淘汰賽 row 一旦有隊就會被 predict——基本免費。需確認：
  - 淘汰賽 **中立場**（無 HFA），除非地主國在自家場（用 A0 的 slot→country）。`elo_to_lambdas` 的 `is_host_home/away` 已是對的開關；λ 用 log-linear（trap #4）。
  - `group_label` null、stage∈{r32,r16,qf,sf,3rd,final} 皆能 predict。
- **advance %（We）= `p_home + 0.5·p_draw`**（trap #6 的 win-expectancy，正是「含 ET/PK 誰晉級」的正確量）。在**顯示層**算，1X2 仍照常存 `match_predictions`。**無新表**。
- **doc 不一致要標**：[schema.sql:26](../etl/sql/schema.sql) 的 stage 註解少了 `'3rd'`，但 `STAGE_MAP` 有 `THIRD_PLACE→'3rd'`（[sources/fixture_source.py](../sources/fixture_source.py)）→ 照 fail-loud/spec-code 原則對齊。

## A2. `/bracket` 頁面與元件（reuse 既有 pattern）

- 新頁 `web/app/[locale]/bracket/page.tsx`，**`export const dynamic='force-dynamic'`**（比照 results/standings/scenarios）。資料用既有 `getFixtures()`（已撈全 stage）＋ `getMatches(v)`（含預測/odds/divergence，目前 `.eq('stage','group')` → **放寬成可取淘汰賽**或新增 `getKnockout(v)`）。
- **bracket tree／slot 模板＝single source of truth（解決審查 #1）**：canonical 放 **`engine/bracket.py`**（R32→R16→QF→SF→3rd→Final 鄰接 ＋ slot 模板 2A/1F/「3(ABCDF)」…）。前端**不手抄第二份**——由生成器產出已 commit 的 `web/lib/bracket.data.json`，`tests/test_bracket.py` 斷言兩邊一致（比照 `golden_vectors` 先例，trap #13c）。`web/lib/bracket.ts` 只是讀該 JSON 的薄包裝/型別。**抽籤前**顯示 slot 模板＋TBD；**抽籤後**填真實隊。
- 元件 reuse：`Flag`、`ProbBar`、`ModelVsMarket`（model/market 並列，trap #7/#13b）、`displayTeamName`（name_zh fallback，trap #14）。新 `BracketColumn`/`BracketMatch`（由 `FixtureRow`/`MatchCard` 改）顯示：兩隊＋比分（settled）／kickoff、**advance % + model vs market**（有 Pinnacle 盤才出 EV/並列，trap #12「無盤不出」）。
- **版本切換**：`?v=` 經 `ModelVersionSwitcher` → `getMatches(v)`；i18n 用 dot-free key（P10 B2）。
- **i18n / nav**：`web/messages/{zh-TW,en}.json` 加 `bracket.*`（reuse 既有 `stage.r32/r16/qf/sf/final`、補 `stage.third`）；`SiteHeader` nav 加 `/bracket`。

## A3. 交付 / 驗收

- `python -m etl.ingest_fixtures --dry-run`（抽籤後）：32 場淘汰賽有隊被收、host 淘汰賽場 venue 解析無 raise；104 不變量仍成立。
- `python -m etl.predict --dry-run`：淘汰賽 matchup 產出 1X2。
- `npm run build --prefix web` 綠；`/bracket` 抽籤前顯示 slot 模板＋TBD、抽籤後顯示隊伍＋advance%＋model vs market；version pill 生效。
- vitest：新元件 render、i18n key 對齊。
- **無新 migration**（reuse `matches`/`match_predictions`/`odds_snapshots`）；新增的是 venues 策展 ＋ web 程式 ＋（可能）手動 bracket 種子。

## CLAUDE.md / 文件同步清單（實作完成時一併更新；審查 #6）
- **§現況/Scope**：加 P13 段落（目前只到 P11）。
- **§結構** web 區：加 `/bracket` 頁、`engine/bracket.py`、`web/lib/bracket.*`。
- **nav**：`SiteHeader` 加 `/bracket`。
- 無新 migration（reuse 既有表）→ 第 114 行 migration 清單不動。
- 文件落點照慣例可升為 `docs/P13-spec.md`。

## 風險 / Open items
1. **fd 是否可靠填淘汰賽隊伍**（A0）：不行 → 需手動 bracket 種子路徑。**先驗證。**
2. **淘汰賽 HFA 建模**：中立 vs 地主自家場 host-aware——推薦 host-aware，documented choice（與 P14 共用 slot→country）。
3. **schema stage 註解缺 `'3rd'`**（A1）→ 標記對齊。
