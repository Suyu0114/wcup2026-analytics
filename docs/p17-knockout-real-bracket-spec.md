# P17 — 真實淘汰賽入格 + 晉級自動預測 + 各頁恢復場次

> 狀態：**已實作**（2026-07-07）。本檔為執行契約與裁決紀錄；與 CLAUDE.md 衝突時以本檔為準。
> 前置：**先在 Supabase 套 [etl/sql/migrations/p17.sql](../etl/sql/migrations/p17.sql)，再部署/跑本次 code**（§6 runbook）。

## 0. 動機（16 強尾聲，2026-07-07）

1. **P16 pending item (b)**：`matches` 無 `match_no` → 真實場次對不進 bracket 樹格（格子以 FIFA match_no 73–104 為 key），只能掛獨立卡片清單。
2. **knockout_sim 不鎖已賽結果**：整個 bracket 從小組賽重模擬，被淘汰隊仍顯示奪冠機率——R32/R16 都是事實之後，這是誠實問題。
3. **首頁 / /matches / /value / /admin 全空**：`getMatches` 硬過濾 `stage='group'`，小組賽全 final 後無物可顯示；admin 無法輸入淘汰賽比分。
4. **無自動化**：recompute 只有 admin/手動觸發；fd 每場結束後會自動填下一輪隊伍，但沒有東西去 ingest。
5. **既有 bug（本次一併修）**：`etl/calibrate.py` 對 ET/PK 淘汰賽用含加時比分對 90 分鐘 1X2 市場計分（fd `fullTime` 含加時）→ 校正資料自 R32 起被污染。

## 1. Schema（p17.sql）

| 欄位 | 型別 | 語意 |
|---|---|---|
| `matches.match_no` | `int unique check (73..104)` | FIFA 場次編號＝bracket 格 join key；group 為 null。ingest 由 kickoff 排程解析（§2）。unique 安全：match_no 是固定 kickoff slot 的確定函數，idempotent 重跑寫同值；漂移在寫 DB 前由 `assert_knockout_match_nos_unique` 攔截。 |
| `matches.winner` | `text check ('home','away')` | fd `score.winner`，缺失時由 decisive fullTime 導出（fd 實測會在**已完賽 PK 場給 winner=null**：537382 SUI v COL）。僅 final 記錄；curated-settle 與 fd 衝突時：decisive → 比分導出、平分 → null。 |
| `matches.result_duration` | `text check ('regular','et','pk')` | fd `score.duration`。`et`/`pk` ＝ 90 分鐘平手（§4 calibrate 依此記 draw）；也是前端 PK/加時標記的來源。 |

⚠️ **fd fullTime 語意（實測 2026-07-07，dry-run fail-loud 抓到）**：WC2026 淘汰賽的 `score.fullTime` 是**累計值＝正規＋加時＋PK 進球**（GER v PAR：reg 1-1、ET 0-0、pens 3-4 → fullTime **4-5**；BEL v SEN：reg 2-2、ET 1-0 → 3-2）。所以 settled KO 的 fullTime **恆分勝負**、勝者可由比分導出；`penalties` 子區塊不可信（537382 寫 3-3 但 fullTime 4-3）→ 不對它做驗證。admin 手動輸入也必須輸入這種「總比分」（UI 有提示），否則 fd 補分時 conflict guard 會中止。

## 2. kickoff → match_no（重用 P16 機制，不做 fd match_id 逐場策展）

- [etl/venues.py](../etl/venues.py)：P16 註解裡的 match_no 升格為資料——`KNOCKOUT_SCHEDULE: dict[kickoff, (match_no, venue)]`（32 筆）；`KNOCKOUT_VENUE_BY_KICKOFF` 由它 derive（`host_flags` API 不變）。新 `schedule_match_no()` 與 venue 同一 nearest-slot ±75min 解析（slot 間隔 ≥3.5h ＝ 唯一）。import-time guard：32 slots、venue 已知、match_nos == {73..104}、無近槽。
- [etl/ingest_fixtures.py](../etl/ingest_fixtures.py) `_knockout_match_no`：KO 場解不到 slot → raise；**交叉驗證** fd stage 與 `engine.bracket.STAGE_RANGES`（fd stage vs FIFA slot 漂移 → raise）。
- `_ko_result_fields` fail-loud 不變量（僅 KO final）：fd-backed **平分 → raise**（fullTime 含 ET+PK 進球＝恆 decisive，見 §1 ⚠️）；winner 與比分矛盾 → raise；winner 缺失 → 比分導出（537382 案例自癒）。**curated-only settle**：decisive → 比分導出 winner、duration null（calibrate 排除）；**平分 → (null, null) 不 raise**＝PK transient（§3）。

## 3. 模擬鎖定（engine，誠實優先）

- [engine/knockout.py](../engine/knockout.py)：
  - `KnockoutMatchState`（match_no/teams/settled/goals/winner）。
  - `resolve_real_winners`：(1) winner 欄（PK 用）→ (2) settled 決定性比分 → (3) **下游反推**（下一輪真實隊伍 ∈ 上游兩隊其一；`match_loser`（m103）反推 SF 勝者）。矛盾 → raise（fd transient，下一輪 recompute 自癒）。**PK 已賽而不可知 → 不入 map（以 We 抽樣＝documented transient）**。
  - `assert_real_bracket_consistent`：feeder 可決定處 vs 真實配對，**無序比對**（fd R16+ 定向可與模板不同，trap #5 精神；顯示一律用真實列定向、**不交換 matches 定向**）。
  - `play_bracket(..., fixed_winners=)`：鎖定場直接晉級；回傳 `(champion, reached, played)`，`played`＝每場參賽者（模板定向）供全樹 occupancy。
- [engine/group_sim.py](../engine/group_sim.py) `simulate_tournament(..., ko_states=)`：16 場 R32 真實隊伍齊 → **real-bracket mode**——跳過小組抽樣與 Annex C（FIFA 實際 bracket 權威，且 ~10× 快）；occupancy 擴到 **73–104 全樹**（已定格 prob 1.0）。ko_states 缺/不齊 → 舊路徑不變（occupancy 維持 R32-only；pre-draw 全樹 occupancy 行數無上界會破 `getBracketSlots` 的 PostgREST ~1000 列上限）。
- [etl/knockout_sim.py](../etl/knockout_sim.py)：`db.fetch_knockout_matches()`（null match_no → raise「先套 p17.sql」）→ ko_states → 傳入；印 `Real bracket: yes/no, X settled, Y locked winners` summary。

## 4. 校正誠實修正（calibrate）

`settled_outcome()`：KO settled 且 `duration in ('et','pk')` → 記 **draw**（90 分鐘定義上平手；模型 1X2 與 Pinnacle h2h 都是 90 分鐘三向）；`regular` → 照比分；duration null（純手動 settle）→ **排除計分** + 印 warning。group 不變。`db.fetch_settled_matches` select 加 `stage,result_duration`。

## 5. 前端

- `getMatches` scope → `'all'`（首頁/matches/value/admin 恢復有料；`getKnockout` 仍 knockout-only）。select + `MatchView` 加 `match_no/home_goals/away_goals/winner`；`getFixtures`/`FixtureView` 加 `winner/result_duration`。
- `/matches`：移除 KnockoutTbd；MatchCard `group_label` null → stage badge；final/live 顯示比分（平分帶 winner → `PK`）。FeaturedMatchCard/value 下拉同樣 stage fallback。
- `/admin`：選項加 stage 前綴（hardcoded zh）＋「已終場」標記；KO 場提示**輸入含加時比分**（否則 fd 補分觸發 conflict guard）；平分輸入 → PK 過渡說明。
- `/bracket`：格子優先序＝**真實場次**（隊伍+比分+PK 標記+LIVE，fd 定向）→ projected（P14 模型佔位，muted 樣式不變）→ slot label；圖例標「實際對戰／賽果」vs「模型預測佔位（實驗性）」（事實/模型分離，trap #13b）。**卡片清單保留**（model vs market 並列＝hard rule #7）。
- `/results` FixtureRow：settled KO 加 `PK · 晉級隊` / `加時` 註記；順修既有 `stage.3rd` dotted-key bug（→ `stage.third`，B2）。
- i18n 新 keys（雙語）：`bracket.pk/aet/live/realLegend/projectedLegend`。

## 6. 自動化 + Runbook

- [recompute.yml](../.github/workflows/recompute.yml) 加 `schedule: cron '17 */2 * * *'`（每 2 小時）。fd transient → 該次 fail-loud，下一 tick 自癒；持續錯誤走 P12 `override_fd`。**決賽（2026-07-19）後移除 cron。**
- **嚴格順序**：
  1. Supabase SQL editor 套 `p17.sql`（舊 code 相容——upsert 只寫給定欄位）。
  2. 本機驗證：`python -m pytest -q`；`python -m etl.ingest_fixtures --dry-run`（32 KO 場均解 match_no；PK 不變量＝fd winner/duration 語意的 verify-don't-assume 檢查點，不符會在寫入前 raise）；`python -m etl.knockout_sim --dry-run --seed 42`（`Real bracket: yes`、被淘汰隊 0%）。
  3. Merge → main（Vercel 部署；Actions 拿到新 pipeline）。**反序＝web select 不存在的欄位 → 頁面全 graceful-empty，比現在更糟。**
  4. 觸發 Recompute（或等 cron）→ 驗證五頁（首頁 featured=QF、/matches KO+stage badge、/admin 下拉含 KO、/value 可算 QF、/bracket 格內真實 R32/R16 比分+QF 對戰+SF/F projected；`?v=dc-v1.1` 仍 graceful）。

## 7. 已知限制 / 誠實註記

- **PK transient**：PK 決勝場在 fd 給 winner（或下一輪隊伍）之前，模擬以 We 抽樣該場——短暫、自癒、有測試釘住；admin 手動輸入平分同理。
- **決賽/季軍戰 PK**：無下游可反推 → 依賴 fd `score.winner`（屆時 knockout_sim 已無意義，僅顯示面）。
- 淘汰賽 HFA 仍為 v1 中立場（P14 follow-up 不變）。
- `calibration_runs` 歷史列含被污染的 ET/PK 計分（本次起新 run 正確；歷史列不回溯改寫——append-only provenance）。
