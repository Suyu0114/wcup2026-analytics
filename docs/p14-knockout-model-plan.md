# P14 — 淘汰賽預測模型（champion / advancement / projected matchups）規劃

> 兩個 plan 之一（Model）。另一份：[docs/p13-knockout-page-plan.md](p13-knockout-page-plan.md)（Page）。
> 狀態：**規劃中、待確認、尚未實作**。

## Context

承 P13 的 Context：淘汰賽層 greenfield，`engine/group_sim.py` 只到「12 組排名 ＋ 8 最佳第三名」即止（[group_sim.py:317-343](../engine/group_sim.py)），無 bracket、無奪冠/晉級機率。

### 2026 新制關鍵差異（本 plan 的核心難點）
R32 8 個「最佳第三名」槽的分配，取決於**是哪 8 組**產生晉級第三名 → FIFA **Annex C 表（C(12,8)=495 組合）**。模擬 bracket 時 matchup 未定，**必須自己 faithful 實作 Annex C**（user 已選 "Faithful Annex C"，符合專案「data integrity over approximation」硬原則）。

R32 16 場（73–88）結構：**8 場固定 W-vs-RU**（如 2A-2B、1F-2C、1C-2F、2E-2I、2K-2L、1H-2J、1J-2H、2D-2G）＋ **8 場 W-vs-「某 5 組候選集的最佳第三名」**（3(ABCDF)、3(CDFGH)、3(CEFHI)、3(EHIJK)、3(BEFIJ)、3(AEHIJ)、3(EFGIJ)、3(DEIJL)）。**精確 slot/tree/Annex-C 須照官方 Annex C 逐字轉錄並加結構性測試**。

### 本 plan（P14 = Model）目標
bracket-wide Monte Carlo，**賽前即可**給每隊奪冠/進各輪機率 ＋ projected matchups；事實/模型分離、每輪重跑、faithful Annex C。

4 個預測項目落點：**Champion / Per-round advancement / Projected matchups → 本 plan（P14）**；Single-match advance % → P13。

---

## B0. Canonical bracket 模板 = `engine/bracket.py`（single source of truth，解決審查 #1）

bracket slot 模板 ＋ tree **不雙處手抄**。canonical 放 **`engine/bracket.py`**（純資料模組）。P13 前端的 `web/lib/bracket.*` 由**生成器**從它產出、**parity test 把關**——比照既有 `golden_vectors` 先例（trap #13c：engine 為 canonical、`gen_golden.py` 生成、vitest 驗 parity）。
- 生成器（如 `web/tests/fixtures/gen_bracket.py` 或 `etl/gen_bracket.py`）讀 `engine/bracket.py` → 寫**已 commit 的** `web/lib/bracket.data.json`。
- parity 測試（`tests/test_bracket.py`）斷言 `json.load(web/lib/bracket.data.json) == engine.bracket` 的 canonical 結構——**有人改 `engine/bracket.py` 沒重生 → 測試紅**（fail-loud / verify-don't-assume）。
- 切分：**bracket 模板＋tree**（P13 也要）放 `engine/bracket.py`；**Annex C 495 表**（只有 P14 要）放 `engine/knockout.py`，`import engine.bracket` 的模板。→ P13 不依賴 P14 即可拿到模板。

## B1. 新引擎 `engine/knockout.py`（純函數，比照 group_sim/value）

- **`ANNEX_C`（策展常數，provenance = FIFA 2026 規則 Annex C，Wikipedia 鏡像）＋ import `engine.bracket` 的模板/tree**：
  - R32 16 槽模板（在 `engine/bracket.py`）：8 場 W-vs-RU（固定組）＋ 8 場 W-vs-3rd（各帶 5 組候選集）。
  - `ANNEX_C`（在 `engine/knockout.py`）: `frozenset(8 個產生晉級第三名的組字母) → {R32-3rd-slot: 指派到的組字母}`（**495 entries**）。
  - bracket tree（在 `engine/bracket.py`）：R32→R16→QF→SF→3rd→Final 鄰接。
  - **結構性測試（fail-loud 文化）**：Annex C 恰 495；每 entry 把 8 個 slot 雙射到那 8 組、每個指派落在該 slot 候選集內；每組的 W/RU 在 R32 模板各出現正確次數；tree 為完整二元淘汰。
- **win-prob（任意 matchup，無 stored 預測）**：用 `engine.dixon_coles.elo_to_lambdas(home_elo, away_elo, is_host_home, is_host_away)` → `score_matrix` → `derive` → **`We = p_home + 0.5·p_draw`** 當「該隊晉級（含 ET/PK）」機率（trap #6；**不另模 PK 細節**，documented modeling choice）。
  - **淘汰賽 HFA 決策（推薦）**：中立場為主；**地主國落在『場館在自家國』的 slot 才給 HFA**（用 P13/A0 的 slot→country；若 P13 未先做，本 plan 自帶一份）。documented choice。
- **`build_r32(winners, runners_up, thirds_by_group)` / `play_knockout(bracket, win_prob_fn, rng)`**：把一次模擬的 12 勝者 ＋ 12 亞軍 ＋ 8 第三名（**需帶組來源**）組成 R32，逐輪抽 We 決勝，記錄每隊到達輪次與是否奪冠。

## B2. 串到既有 Monte Carlo（reuse、不分叉）

- per-sim group 解析已現成：`_build_group_standings` → `rank_group` → 收第三名 → `rank_third_places`。**Annex C 需要『組來源』**，但 **不改 `rank_third_places` 簽名**（避免動既有公共 API / P2 測試，解決審查 #2）：`simulate_groups` 內已建 `team_group` map（[group_sim.py:305-310](../engine/group_sim.py)），8 個晉級第三名 team_id 直接 `team_group[tid]` 反查組別即可。
- 加 `simulate_tournament(...)`（或在現有 inner loop 內加 knockout pass）：同一批 N 模擬，group 解析後接 `build_r32`＋`play_knockout`，聚合每隊 `p_make_r16/qf/sf/final/champion` ＋ 每 slot 佔據分布。
- **D3 settled 鎖定沿用**：小組賽已 final 鎖實際比分；**淘汰賽已 final 場也要鎖**（每輪重跑、吃當前真實 bracket，比照 P10）。
- 這裡是**模型輸出**（有 model_version、標實驗性），故用模擬 OK；但**不**把 `rank_group→Elo→random` 當「事實」呈現（trap P11 的分叉理由）。

## B3. ETL job + schema

- 新 `etl/knockout_sim.py`（比照 `etl/simulate.py`）：讀 matches ＋ predictions（小組賽 λ）＋ Elo → 引擎 → upsert。flags：`--dry-run / --n / --seed / --model-version`（每輪對 v1.1、v1.2 各跑一次，比照 P10）。
- 新 migration `etl/sql/migrations/p14.sql`：
  - **`knockout_sim`**（per-team，PK `(team_id, model_version)`）：`p_make_r16, p_make_qf, p_make_sf, p_make_final, p_champion, sim_n, model_version, computed_at`。（"reach R32" = 既有 `group_sim.p_advance`，不重存。）
  - **`bracket_slot_sim`**（projected matchups，PK `(slot_id, team_id, model_version)`）：每 R32 slot 的隊伍佔據機率分布（top-K）→ 前端可呈現「最可能對位／最可能決賽組合」。
- **pipeline 順序**（接在 `etl.simulate` 後）：`ingest_fixtures → standings → scenarios → simulate(v1.2) → simulate(v1.1) → knockout_sim(v1.2) → knockout_sim(v1.1) → ingest_odds → calibrate`（更 `.github/workflows/recompute.yml`）。

## B4. 前端呈現（champion / advancement / projected）

- 在 `/bracket`（P13）疊加，或新「奪冠機率」區塊：每隊 `p_champion`／各輪 reach；slot 佔據用 `bracket_slot_sim`。
- **嚴格事實/模型分離**：全部標「模型・實驗性」、受 `?v=`、缺則 graceful、措辭不得讀起來像確定（trap #13b）。
- **trap #7「必須與市場並列」的明確例外（解決審查 #5）**：奪冠/各輪/projected 機率**無對應市場盤**（outright 賠率不在現有 ingest 範圍）→ **單列模型 + 標實驗性**，比照 P11 scenarios 先例。spec 內須 **explicitly document 此例外**：trap #7 的並列義務針對「有對應市場盤的 match 機率」，無盤的衍生量沿用 P11 模式（無盤不出 EV、可單列標實驗）。
- `data.ts` 加 `getKnockoutSim(v?)`／`getBracketSlots(v?)`（server-only，service key）。i18n 補 key。

## B5. 交付 / 驗收

- pytest（`engine/knockout.py`）：Annex C 495 ＋ 雙射 ＋ 候選集合法；tree 完整；We 單調（Elo 高勝率高）；**每隊 round-reach 單調**（`p_champion ≤ p_make_final ≤ p_make_sf ≤ … ≤ p_advance`）；全隊 `p_champion` 合計 ≈ 1。
- `python -m etl.knockout_sim --dry-run --seed 42`：印 top 奪冠機率、deterministic。
- 套 `p14.sql` → 對 v1.1/v1.2 各跑一次 → 前端奪冠/各輪/projected 顯示、version pill 生效、標實驗性。
- 文件：新 `docs/P14-spec.md`（比照 P11-spec 的事實/模型分離與誠實契約段）＋ CLAUDE.md 加 P14 段。

## CLAUDE.md / 文件同步清單（實作完成時一併更新；審查 #3/#4/#6）
- **§現況/Scope**：加 P14 段落（目前只到 P11）。
- **§指令 第 114 行 migration 清單**：加 `p14.sql`（與 p6/p8/p11 並列「需先在 SQL editor 套用」）。
- **§指令 每輪資料更新順序**：在 calibrate 前插入 `knockout_sim(v1.2)`／`knockout_sim(v1.1)`。
- **`.github/workflows/recompute.yml`**：pipeline 加 `knockout_sim` 兩版（B3）。
- 新增指令列：`python -m etl.knockout_sim [--dry-run] [--n] [--seed] [--model-version <v>]`。

## 風險 / Open items
1. **Annex C 轉錄正確性**：須對官方 Annex C 逐字核對 ＋ 結構性測試把關（B1）。
2. **淘汰賽 HFA 建模**：中立 vs 地主自家場 host-aware——推薦 host-aware（與 P13 共用 slot→country）。
3. **ET/PK** 以 We 代表晉級，不另模 shootout——documented choice。
4. **bracket 模板分叉**：已由 B0 的 single-source-of-truth（`engine/bracket.py` canonical + 生成 web 檔 + parity test）解決，不再雙處手抄。

## 與 P13 的關係 / 順序
- 共用 `engine/dixon_coles`（已存在）、slot→country/venue 策展、bracket slot 模板。
- P13 抽籤後即可出貨（不需 Monte Carlo）；P14 賽前即可出貨（不需真實抽籤）。建議 **P13 先（時效）**、P14 並行。兩者都遵守每輪重跑＋D3 settled 鎖定（P10 模式）。
