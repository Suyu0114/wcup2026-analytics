# CLAUDE.md

World Cup 2026 Analytics — 賽事預測/分析平台的工程指南。
**完整實作規格見 [docs/P0-P1-spec.md](docs/P0-P1-spec.md)（「執行契約」，與本檔衝突時以 spec 為準）。**

## 專案原則（硬性）
- **verify-don't-assume**：跨來源資料一律驗證，不臆測。
- **data integrity over approximation**：寧可 raise，也不要默默近似 / 補值。
- **fail-loud**：ETL 遇到對不上的隊名、缺欄位、數量不符 → 直接 raise，不靜默吞掉。
- **spec 與 code 不符 → 立即標記**，不要自行二選一硬實作。
- **idempotent**：所有 ETL job 用 upsert，可重複執行。
- **provenance**：寫入一定帶 as-of / source。

## 現況 / Scope
已做 **P0（資料層）+ P1（預測引擎）+ P2（晉級模擬）+ P3（EV/value + 賠率 ingest + 校正）+ P5（i18n/UI）**。P4（球員 props）不在範圍，**不要提前實作**（見 spec §8 / [docs/P3-spec.md](docs/P3-spec.md) §10 / [docs/P5-spec.md](docs/P5-spec.md) §0）。
- **P0** — Supabase schema、Elo ingest、fixtures ingest、identity mapping。
- **P1** — Dixon–Coles Poisson 引擎 → `match_predictions`（Feature 1：1X2 + 爆冷；Feature 3：大小分）。
- **P2** — Monte Carlo 群組賽模擬 → `group_sim`（Feature 4：每隊晉級機率）。score matrix 多項式抽樣、已結算鎖定、H2H 線性狀態機 tiebreaker。spec：[docs/P2-spec.md](docs/P2-spec.md)。
- **P3** — The Odds API → `odds_snapshots`（變動才存）；Pinnacle 去 vig EV/Kelly（[engine/value.py](engine/value.py)，純函數）；`model_total_lines`（實際線重算）；校正學習線（T10，**非 gate**）。spec：[docs/P3-spec.md](docs/P3-spec.md)。
- **P5** — `web/` Next.js（App Router）+ Tailwind 前端，雙語 zh-TW/en（`next-intl`）。呈現 F1/F3/F4/F5；**不新增模型/ETL、前端不寫 DB**。資料走 server-side service-key API（**`SUPABASE_SERVICE_KEY` 嚴禁進 client**）；EV 使用者賠率算術在 client（[web/lib/value.ts](web/lib/value.ts)，port `engine/value.py`，model-free）；市場去 vig 在 server。spec：[docs/P5-spec.md](docs/P5-spec.md)。

### P6 — code 完成（2026-06-10；spec + 修訂清單 + 裁決/實作紀錄：[docs/P6-spec.md](docs/P6-spec.md) §6/§11/§12）
- **A1 地主 HFA 已啟用**：[etl/venues.py](etl/venues.py) 策展表（fd 無 venue，實測 0/104）。⚠️ **fd 把第三輪地主列客隊**（如 Czechia v Mexico 在 Azteca）→ 引擎加對稱 `is_host_away`（不交換 matches 定向）；小組賽不變量 = host_home 6 + host_away 3（TA1）。
- **A2 歷史擬合 → dc-v1.1 已上線**：`fit/fit_dc.py`（martj42 CC0 × Elo 年度快照；**只用賽前快照，禁止向後內插＝leakage**）。gate PASS（val log-loss 1.0492 vs v1.0 先驗 1.1239）；部署 `BASE 1.2014 / GAMMA 0.5478 / HFA 84.5 / RHO −0.12`（provenance：[fit/REPORT.md](fit/REPORT.md)）。T9 錨點對 v1.1 降為診斷（test 以 v1.0 先驗 monkeypatch 保留）。
- **A3 市場分歧診斷**：`python -m etl.diagnose_market`（read-only → fit/DIAGNOSIS.md）。v1.0 實測：高估強隊 +3.9pp、低估 draw −3.5pp、totals over +10.2pp——與擬合方向互相印證（唯一外部基準）。
- **B value v2**：雙模式（市場預設 ⇄ 模型〔實驗〕，selectProb 單一選點、永不混算）；紅黃綠三級 + 「每注100」+ 打平勝率 + 比價；totals 模型線格 1.5–4.5 push-aware（quarter EV 精確）；模型模式 Kelly 鎖（`calibration_runs` 最新列：n≥30 且 Brier≤市場×1.1，server 判）；近似旗標新規則（市場模式僅 half line 精確）；locale 預設（zh-TW decimal+HK / en decimal+American、TWD/CAD）；分地區 RG 資源；/value 頂部分歧清單。
- **schema 增量待套用**：[etl/sql/migrations/p6.sql](etl/sql/migrations/p6.sql)（`matches.is_host_away`、`model_total_lines.model_p_push`、`calibration_runs`）→ 套用後重跑 ingest_fixtures → predict → simulate → ingest_odds（含線格）→ calibrate。

### P8 — 賽程/成績頁 + 小組積分榜頁（code 完成）
- **`group_standings` 表（[etl/sql/migrations/p8.sql](etl/sql/migrations/p8.sql)）**：FIFA 式實際積分榜（P/W/D/L/GF/GA/GD/Pts/rank/tied），由 [etl/standings.py](etl/standings.py)（讀 `matches` → [engine/standings.py](engine/standings.py) → upsert）算，**只算 `status='final'`**。**是事實非模型**：無 model_version、不經校正；組成員由 fixtures 推導。已加進 recompute pipeline（`ingest_fixtures` 後）。
- **排名 tiebreaker = 顯示用**：Pts→GD→GF→H2H，之後仍同分**並列 `tied`**（**不**用 Elo/隨機；與模擬 `group_sim.rank_group` 區隔，H2H 數學共用 `_compute_h2h_stats`）。FIFA 公平競賽分/抽籤未模擬（footnote 標注）。
- **前端兩頁**：`/results`（[web/app/[locale]/results/page.tsx](web/app/[locale]/results/page.tsx)，`getFixtures()` 撈全階段、依 `stage` switch、依日期分組）+ `/standings`（[web/app/[locale]/standings/page.tsx](web/app/[locale]/standings/page.tsx)，`getStandings()` 12 組）。兩頁 **`export const dynamic='force-dynamic'`**（matchday 改分即時反映，不走 30 分鐘 ISR）。晉級視覺分級：1/2 名實綠、3 名虛線淡綠、4 名無框。

### P10 — 賽中 Elo 更新 + dc-v1.2 重新預測 + UI 版本切換器（code 完成；spec [docs/P10-spec.md](docs/P10-spec.md)）
- **dc-v1.2 = 同引擎常數 + 新 Elo 快照**（不重擬合，BASE/GAMMA/HFA/RHO 不變）。`engine.MODEL_VERSION` 與 web `lib/constants.ts MODEL_VERSION` 已 bump `dc-v1.2`；web 另有 **`BASELINE_VERSION='dc-v1.1'`**（賽前凍結基線）。
- ⚠️ **track-record 釘 `BASELINE_VERSION`、不跟 active 版本**（[getTrackRecord()](web/lib/data.ts)）：否則 bump 後 settled 比賽無 v1.2 pred → 整頁空白（P10 陷阱 B1）。
- **後端 flag**：`predict --only-unsettled`（只重算 `status!='final'`）；`simulate --model-version <v>`（**每輪對 v1.1 與 v1.2 各跑一次**，兩者都吃 settled D3 鎖定 → groups 差異純反映 Elo）。`fetch_group_matches_with_predictions` 已放寬：settled 缺該版本 pred → lambda 用 `0.0` placeholder（D3 路徑不讀 lambda，安全）。
- **前端版本切換器**（[web/components/ModelVersionSwitcher.tsx](web/components/ModelVersionSwitcher.tsx)）：全域 pill、URL `?v=`（預設最新不帶 param、**merge 既有 param**、`replace(scroll:false)`）；影響 matches/groups/value/home。`data.ts` 函數加 `modelVersion?`；**value 模型/EV 經 `/api/value/market?v=`**（client API route，P10 B3）。i18n 標籤用 **dot-free key**（`v1_1`/`v1_2`；next-intl 以 `.` 為巢狀路徑分隔，dotted key 會解析失敗 = B2）。
- **每輪資料更新順序**：手動更 Elo CSV → `ingest_elo` → `predict --only-unsettled` → `simulate --model-version dc-v1.2` → `simulate --model-version dc-v1.1` → `ingest_odds` → `calibrate`。⚠️ predict 對 `(match_id, model_version)` upsert，同輪重抓 Elo 會原地覆寫 v1.2（provenance：每輪只在該輪結束後抓一次）。

### P11 — 小組賽晉級情境分析（code 完成；spec [docs/P11-spec.md](docs/P11-spec.md)）
- **`group_scenarios` 表（[etl/sql/migrations/p11.sql](etl/sql/migrations/p11.sql)）**：對每場 `status!='final'` 的小組賽，三種結果 (W/D/L) 分別把**兩隊**的晉級狀態變成什麼。由 [etl/scenarios.py](etl/scenarios.py)（讀 `matches` → [engine/scenarios.py](engine/scenarios.py)）算 → **delete-all + insert**（rows 隨比賽 settle 而消失，純 upsert 會留殘列；表內**永不含 final 場**）。**事實非模型**：無 model_version、不經校正。pipeline 在 `etl.standings` 後。
- **狀態**：`top2_clinched`（鎖前二，與跨組無關＝事實）/ `eliminated`（必第 4＝事實）/ `alive`（仍有條件）；facet `seeding_live`（已晉級但 1 vs 2 未定）、`needs_best_third`、`secured_3rd_or_better`、`can_win_group`。match-level `convenience_draw`（強義＝draw 下兩隊皆 `top2_clinched`）/ `dead_rubber`（晉級**與名次**皆已定）。
- ⚠️ **誠實契約（spec §3）**：組內用 **points-band**（積分相同即視為名次未定／可換位）＝ **sound over-approximation**：永不誤報 clinch/eliminate，只會保守少報（「靠 GD 才成立的 clinch」標 `alive`，**刻意** false-negative，非 bug）。**跨組第三名 GD 看不到 → 第三名去留一律 `alive`（v1-lean），不做決定性 clinch**（§6 follow-up 才考慮）。
- **重用、不分叉**：組內排名走 [engine/standings.py](engine/standings.py) 的決定性顯示排名思路、H2H 數學共用 `_compute_h2h_stats`；**不**呼叫 `group_sim.rank_group`/`rank_third_places` 當事實（其 `…→Elo→random` 是模擬強制全序，當事實會謊報——同 P8 分叉理由）。
- **前端 `/scenarios`**（[web/app/[locale]/scenarios/page.tsx](web/app/[locale]/scenarios/page.tsx)，`getScenarios()`，**force-dynamic**）：按組編排（mini 積分榜 context + [ScenarioCard](web/components/ScenarioCard.tsx)）。`alive` 隊附 `group_sim` 機率小字，**標「模型・實驗性」、受 `?v=`、缺則 graceful、措辭不得讀起來像 clinch**（事實/模型分離，trap #13b；此處**無對應市場盤** → hard rule #7 並列義務不適用）。

### P13 — 淘汰賽 bracket 頁（code 完成；規劃 [docs/p13-knockout-page-plan.md](docs/p13-knockout-page-plan.md)。配對的 P14 模型＝[docs/p14-knockout-model-plan.md](docs/p14-knockout-model-plan.md)，**未實作**）
- **2026 新制**：12 組 → R32 = 各組前二（24）＋ **8 最佳第三名**；8 個第三名照 FIFA **Annex C（C(12,8)=495）** 配入 R32 槽。抽籤後真實 bracket 由 fd 直接給（**本頁顯示用不到 Annex C**；模擬才需＝P14）。
- **canonical bracket＝[engine/bracket.py](engine/bracket.py)（single source of truth）**：matches 73–104 的 slot 模板＋8 個第三名候選集＋feeder tree。web 端讀**生成**的 [web/lib/bracket.data.json](web/lib/bracket.data.json)（`python web/tests/fixtures/gen_bracket.py` 重生；parity 由 [tests/test_bracket.py](tests/test_bracket.py) 把關，比照 golden_vectors，trap #13c）。structural 不變量測試（12 勝者/亞軍各一、8 第三名槽、候選集 40、tree 完整）。**改 engine/bracket.py 要重生 JSON**。
- **前端 `/bracket`**（[web/app/[locale]/bracket/page.tsx](web/app/[locale]/bracket/page.tsx)，**force-dynamic**、受 `?v=`）：[BracketView](web/components/BracketView.tsx) 永遠畫 slot 模板（抽籤前 TBD）；抽籤後 `getKnockout(v)`（與 `getMatches` 共用 `buildMatchViews`）列出真實淘汰賽 [KnockoutMatchCard](web/components/KnockoutMatchCard.tsx)：**single-match advance %（We＝p_home+½·p_draw，trap #6）＋ model vs market 並列**。
- **predict 免改**：[etl/predict.py](etl/predict.py) 無 stage filter，淘汰賽 row 一有隊即自動預測（中立場，HFA 僅地主自家場經 is_host flags）。
- ⚠️ **post-draw 待補（gated on 抽籤）**：(a) 淘汰賽 host 場 venue 補進 [etl/venues.py](etl/venues.py) `MANUAL_VENUE`（缺則 `host_flags` raise）；(b) 策展 match_no↔fd match_id 後可把真實場次填進 bracket 格（目前真實場次走獨立清單，非 in-cell）；(c) odds 同隊再遇去重 collision（trap #12）；(d) fd 是否可靠填淘汰賽隊伍待驗，不行需手動 bracket 種子。

### P14 — 淘汰賽奪冠/晉級模擬（backend code 完成、前端待做；規劃 [docs/p14-knockout-model-plan.md](docs/p14-knockout-model-plan.md)）
- **bracket-wide Monte Carlo**：小組賽解析（重用 P2）→ R32（**faithful Annex C**）→ 單淘汰至奪冠。產 per-team `p_make_r16/qf/sf/final`＋`p_champion`（`knockout_sim`）＋ per-R32-slot 佔據（`bracket_slot_sim`＝projected matchups）。**模型輸出**（有 model_version、實驗性）。
- **Annex C＝[engine/data/annex_c.json](engine/data/annex_c.json)（495 列，事實非可推導）**：C(12,8) 每組合每槽各有 **3–214 種合法配對** → FIFA 指定，**不可算**。由 [engine/data/gen_annex_c.py](engine/data/gen_annex_c.py) 從 Wikipedia「Combinations…round of 32」表 scrape＋**硬驗證**（495、雙射、no same-group、且每 `3X` ∈ [engine/bracket.py](engine/bracket.py) 候選集＝與已驗 bracket 交叉核對）。重抓需 `requests`+`lxml`。
- **引擎 [engine/knockout.py](engine/knockout.py)**：`advance_prob`＝We＝`p_home+½·p_draw`（無平局，含 ET/PK，trap #6；**不另模 PK**）；`resolve_r32`（Annex C 配第三名）；`play_bracket`。**淘汰賽中立場（v1 無 HFA）**——地主自家場 host-aware 為 follow-up（需 slot→venue 策展，同 P13 gate；`advance_prob` 已留 host 參數）。
- **driver [engine/group_sim.py](engine/group_sim.py) `simulate_tournament`**：重用 P2 解析（`_presample` 抽出共用；**不改 `rank_third_places` 簽名**——第三名組來源用 `team_group` map 反查，§B2）。settled 小組賽鎖定（D3）；**settled 淘汰賽鎖定為 post-draw follow-up**。
- **job [etl/knockout_sim.py](etl/knockout_sim.py)**：讀同 simulate 的 group matches+preds+Elo → `knockout_sim` upsert＋`bracket_slot_sim` delete-by-version+insert。**每輪對 v1.1、v1.2 各跑一次**（接在 `etl.simulate` 後；須先套 [etl/sql/migrations/p14.sql](etl/sql/migrations/p14.sql)）。**recompute.yml 待 p14.sql 套用後再加入**（否則寫不存在的表會炸）。
- ⚠️ **前端待做**：champion/advancement/projected UI（`getKnockoutSim`/`getBracketSlots`，**experimental、無對應市場盤＝trap #7 例外**，同 P11）。

## 結構
```
docs/P0-P1-spec.md     ← P0/P1 執行契約；P2-spec.md ← P2；P3-spec.md ← P3；P5-spec.md ← P5；P6-spec.md ← P6（已實作，修訂 P3/P5 契約）
etl/                   ← ingestion + jobs（Elo / fixtures / alias / odds / predict / simulate / calibrate）
  sql/schema.sql       ← Postgres DDL（P0/P1 §3 + P2 §2 + P3 §3）
  simulate.py          ← P2 Monte Carlo 模擬 job（讀 DB → 引擎 → 寫 group_sim）
  data/raw/elo/        ← Elo CSV（third-party，git-ignored；provenance 見其 README）
  data/raw/intl_results/ ← martj42 歷史賽果（CC0，git-ignored；P6 fit 用；README 有比分定義陷阱）
  ingest_odds*.py      ← P3 賠率 alias seeding + ingest；model_lines.py（P6 線格+push）/ calibrate.py（P6 落表）
  venues.py            ← P6 A1 地主場館策展（fd 無 venue；host_away 陷阱見其 docstring）
  diagnose_market.py   ← P6 A3 市場分歧診斷（read-only）
  standings.py         ← P8 積分榜 job（讀 matches → engine/standings → 寫 group_standings；只算 final）
  scenarios.py         ← P11 晉級情境 job（讀 matches → engine/scenarios → 寫 group_scenarios；delete-all+insert，只算未終場）
  knockout_sim.py      ← P14 全賽事 Monte Carlo job（讀 matches+preds+Elo → group_sim.simulate_tournament → 寫 knockout_sim + bracket_slot_sim；每輪每版本各跑一次）
  sql/migrations/p6.sql ← P6 增量 DDL（既有 DB 用這個）；p8.sql ← P8 group_standings；p11.sql ← P11 group_scenarios；p14.sql ← P14 knockout_sim + bracket_slot_sim
fit/                   ← P6 A2 離線擬合（fit_dc.py → REPORT.md / DIAGNOSIS.md）
sources/               ← adapter（RatingSource / FixtureSource / TheOddsApiSource）
engine/                ← Dixon–Coles 引擎（spec §5）+ group_sim.py（P2 純函數模擬）+ value.py（P3 EV/Kelly）+ standings.py（P8 顯示排名，事實非模型）+ scenarios.py（P11 晉級情境，points-band，事實非模型）+ bracket.py（P13 淘汰賽 canonical 結構，single source of truth → web/lib/bracket.data.json）+ knockout.py（P14 Annex C 配對 + We 晉級 + 單淘汰 play）+ group_sim.simulate_tournament（P14 全賽事 Monte Carlo）；data/annex_c.json（P14 FIFA Annex C 495 列）
web/                   ← P5 Next.js 前端（App Router + Tailwind + next-intl）
  app/[locale]/        ← 頁面（home / matches / results / standings / scenarios / groups / bracket / value）；app/api/* ← server route handlers
  lib/                 ← supabaseServer（service key, server-only）/ devig（server）/ value.ts（port, model-free）/ upset / data
  components/          ← ModelVsMarket（並列核心）/ ProbBar / ValueCalculator（client island）/ footers …
  messages/{zh-TW,en}.json  ← UI 字典（key 一一對應）；tests/ ← value/upset/i18n（golden_vectors 由 value.py 生成）
```

## 高風險陷阱（動 code 前先讀；皆已在 spec 處理）
1. **Canonical `team_id` = eloratings `country_code`（兩碼，如 EN/KR/BR）**，**不要 hardcode FIFA 三碼**（CRO vs CRC 之類易錯）。
2. **Elo CSV 含 future-dated 年底欄位**（如 2026-12-31，數值複製自當期 live）。只取「不在未來」的最新快照；直接 `max(snapshot_date)` 會讓 `elo_asof` provenance 變假（數值對、日期錯）。
3. **跨來源隊名一律經 `team_aliases` 解析成 `team_id`**；對不上 → raise，**不准默默新增 team**。
4. **λ 用 log-linear**（spec §5.1），**不要**用加法式 `(total − supremacy)/2`（強弱差大時 λ 變負，Poisson 爆掉）。
5. **主場優勢只給地主三國**（US/CA/MX）：P6 起經 [etl/venues.py](etl/venues.py) 策展表啟用（fd 無 venue）。⚠️ **fd 第三輪把地主列客隊** → 用 `is_host_away`（對稱 −HFA），**不准交換 matches 定向**（odds/賽果 ingest 對齊 fd）。地主場次缺策展 → raise（淘汰賽抽完要補表）。HFA 擬合值 84.5 Elo。
6. **We ≠ p_home**：spec 的 64/76/91% 是 win expectancy（含平局）。校正 GAMMA 要對 `We_model = p_home + 0.5·p_draw`，**別拿 p_home 直接對 64%**。
7. **市場效率**：引擎輸出在 UI **必須與市場賠率並列**，不可單獨呈現為「正確答案」。
8. **校正參數已是 P6 A2 擬合值**（dc-v1.1，provenance 在 [fit/REPORT.md](fit/REPORT.md)），別改回先驗。重擬時硬規則：**賽時 Elo 只用賽前快照、禁止向後內插**（look-ahead leakage，fit 陷阱 #1）；gate = validation log-loss 贏 baseline 才 bump。版本常數 Python `engine.MODEL_VERSION` 與 web `lib/constants.ts` **同 change 一起 bump**。
9. **CC BY-SA 4.0**：Elo 資料要標 attribution（網站放 footer）。
10. **淘汰賽賽前 TBD**：賽前 32 場淘汰賽在 football-data 是 **null 隊伍**。fixtures ingest **只收 72 場有隊的小組賽**、跳過未抽籤者；idempotent 重跑會補上。TF1 的「104 列」是賽事期間不變量，賽前實為 72 收 + 32 skip。⚠️ 與 spec §4.2 / TF1 字面不符（已知、刻意；待 spec 對齊）。
11. **手動 alias 在 [etl/identity.py](etl/identity.py) `MANUAL_ALIASES`**：實測只 3 隊需手補（Bosnia-Herzegovina→BA、Cape Verde Islands→CV、Congo DR→CD）。spec §2.2 猜的 Türkiye / Côte d'Ivoire / Korea 其實自動對上；換來源要重驗。
12. **P3 賠率（[docs/P3-spec.md](docs/P3-spec.md)）**：The Odds API 又一套隊名 → `MANUAL_ALIASES_ODDS`（實測只 `Czech Republic`→CZ）。EV **預設**比 Pinnacle 去 vig；P6 起有模型模式（opt-in、實驗標籤、**永不混算**）——機率選擇集中在 [web/lib/selectProb.ts](web/lib/selectProb.ts)（單一選點，TB8），`engine/value.py`/`web/lib/value.ts` 仍不 import 模型/市場資料。**無 Pinnacle 盤 → 任何模式不出 EV**。`odds_snapshots` **變動才存**（以**價格 vs 最新**比對；⚠️ last_update 會空轉、不可當去重鍵，實測 2026-06-09）。totals 模型圖層在 **Pinnacle 實際線**重算（`model_total_lines`），非 `p_over_2_5`。event→match 用無序隊伍對（淘汰賽再遇要時間/輪次硬判）。
13. **P5 前端（[docs/P5-spec.md](docs/P5-spec.md)）**：(a) `SUPABASE_SERVICE_KEY` **只在 server**（`web/lib/supabaseServer.ts` 帶 `import 'server-only'`；**勿加 `NEXT_PUBLIC_`**，否則洩 key）。(b) 模型輸出 UI **永遠與市場去 vig 並列 + 標「實驗性」**，絕不單獨當「答案」（[web/components/ModelVsMarket.tsx](web/components/ModelVsMarket.tsx)）。(c) value 算術 client 端隔離：`web/lib/value.ts` **不含 `novig`、不 import 模型**（去 vig 在 server `web/lib/devig.ts`）；改 `engine/value.py` 後**要重生 golden_vectors**（`python web/tests/fixtures/gen_golden.py`，需 `PYTHONPATH`=repo root）保 parity。(d) DB 缺資料是 **graceful 空狀態非錯誤**（§6.6）；別讓前端對空資料 throw。(e) schema **不需新 RLS**（service-key bypass）。
14. **P5 隊名顯示**：`name_zh` 由 [etl/seed_team_names_zh.py](etl/seed_team_names_zh.py) 策展種子（48 隊繁中、非機翻、idempotent；無 `name_zh` 時前端 fallback `name_en`）。國旗用 **flag-icons SVG，非 emoji**（Windows 不渲染 emoji 國旗，會變兩碼字）；`team_id → flag code` 經 [web/lib/flag.ts](web/lib/flag.ts)，**team_id ≠ 全等 ISO-3166**：實測 48 隊只 `EN→gb-eng`、`SQ→gb-sct` 兩例需 override（其餘 `lowercase`）。換 team 來源要重驗。

## 環境變數
複製 `.env.example` → `.env`（git-ignored，**勿提交**）：
- `FOOTBALL_DATA_TOKEN` — football-data.org（程式發 request 時放進 `X-Auth-Token` header）
- `SUPABASE_URL` / `SUPABASE_SERVICE_KEY`
- `ODDS_API_KEY` — P3 才需要

## 驗收
遵循 PASS/FAIL smoke-test 文化（spec §6，T0–T9）。改動引擎或 ETL 後跑對應測試。
market-calibration gate（T10）延到 P3：模型過不了校正，value 判定就是放煙火。

## 指令
canonical env = conda `WC2026`（見 [docs/ENVIRONMENT.md](docs/ENVIRONMENT.md)）。安裝 `pip install -r requirements.txt`。
- 測試：`python -m pytest -q`（離線測試綠；3 個 odds 整合測試在 `etl.ingest_odds` 後轉綠；TF5/部分需 Supabase creds）
- Elo ingest：`python -m etl.ingest_elo [--dry-run]`（`--dry-run` 連 Supabase 都不需要）
- Alias 種子：`python -m etl.ingest_aliases [--dry-run]`（需 `FOOTBALL_DATA_TOKEN`；**先於** fixtures）
- Fixtures ingest：`python -m etl.ingest_fixtures [--dry-run]`
- 預測（P1/P10）：`python -m etl.predict [--dry-run] [--only-unsettled]`（→ `match_predictions`，model `dc-v1.2`；`--only-unsettled` 只重算 `status!='final'`，P10 賽中重預測）
- 模擬（P2/P10）：`python -m etl.simulate [--dry-run] [--n 10000] [--seed 42] [--model-version <v>]`（→ `group_sim`，48 隊晉級機率；需先跑 predict。P10：每輪對 `dc-v1.2` 與 `dc-v1.1` 各跑一次，兩者都吃 settled D3 鎖定）
- 積分榜（P8）：`python -m etl.standings [--dry-run]`（→ `group_standings`，12 組 FIFA 式實際積分榜；只算 `status='final'`，從 `matches` 即時計算；非模型、無 model_version。在 recompute pipeline 內 `ingest_fixtures` 後跑）
- 晉級情境（P11）：`python -m etl.scenarios [--dry-run]`（→ `group_scenarios`，每場未終場小組賽 W/D/L × 兩隊晉級狀態；points-band 事實、無 model_version；delete-all+insert。在 recompute pipeline 內 `etl.standings` 後跑）
- 淘汰賽模擬（P14）：`python -m etl.knockout_sim [--dry-run] [--n 10000] [--seed 42] [--model-version <v>]`（→ `knockout_sim` 每隊各輪+奪冠機率 ＋ `bracket_slot_sim` projected matchups；bracket-wide Monte Carlo，group→R32 faithful Annex C→單淘汰。需先跑 predict；每輪對 `dc-v1.2`、`dc-v1.1` 各跑一次，接在 `etl.simulate` 後。先套 p14.sql）
- 重生 Annex C 表（P14，離線，需 `requests`+`lxml`）：`python engine/data/gen_annex_c.py`（→ `engine/data/annex_c.json`，scrape+硬驗證 495 列）
- Odds alias 種子（P3）：`python -m etl.ingest_odds_aliases [--dry-run]`（需 `ODDS_API_KEY`；**先於** odds ingest）
- Odds ingest（P3）：`python -m etl.ingest_odds [--dry-run]`（1 call/2 credits；含 `model_total_lines` 重算）
- 校正（P3/P6）：`python -m etl.calibrate [--dry-run]`（T10 學習線，非模型 gate；每次 run 對**所有版本**計分並 append `calibration_runs`——模型模式 Kelly 鎖的資料源）
- 市場分歧診斷（P6 A3）：`python -m etl.diagnose_market`（read-only → fit/DIAGNOSIS.md）
- 歷史擬合（P6 A2，離線）：`python -m fit.fit_dc`（→ fit/REPORT.md；gate 沒過**不准** bump 引擎常數）
- 隊名中文種子（P5）：`python -m etl.seed_team_names_zh [--dry-run]`（策展 48 隊 `name_zh`，繁中非機翻；idempotent。Windows console 印中文需 `PYTHONUTF8=1`）
- 不帶 `--dry-run` = 寫入 Supabase，需 `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` + 已套用 [etl/sql/schema.sql](etl/sql/schema.sql)（**P2 `group_sim` / P3 三物件 / P6 [etl/sql/migrations/p6.sql](etl/sql/migrations/p6.sql) / P8 `group_standings` [etl/sql/migrations/p8.sql](etl/sql/migrations/p8.sql) / P11 `group_scenarios` [etl/sql/migrations/p11.sql](etl/sql/migrations/p11.sql) / P14 `knockout_sim`+`bracket_slot_sim` [etl/sql/migrations/p14.sql](etl/sql/migrations/p14.sql) 需先在 SQL editor 套用**）。

### P5/P6 前端（在 `web/`，Node ≥ 20 + npm；本機 Node 裝在 conda WC2026 → 前綴 `conda run -n WC2026`）
- 安裝：`npm install --prefix web`（env 複製 `web/.env.example` → `web/.env.local`，填 `SUPABASE_URL` / `SUPABASE_SERVICE_KEY`）。
- 開發：`npm run dev --prefix web`（http://localhost:3000 → 自動導向 `/zh-TW`）。
- 測試：`npm test --prefix web`（vitest：value/push-aware parity、selectProb、verdict/divergence、雙模式 component tests、i18n key 對齊；離線，84 passed）。
- 建置：`npm run build --prefix web`（含 TS type-check；無 DB creds 也能建——頁面走 graceful 空狀態）。
- 部署：Vercel，Root Directory 設 `web`，secrets 設 `SUPABASE_URL` / `SUPABASE_SERVICE_KEY`（**service key 勿加 `NEXT_PUBLIC_`**）。
