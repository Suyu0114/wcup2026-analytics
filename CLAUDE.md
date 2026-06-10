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

## 結構
```
docs/P0-P1-spec.md     ← P0/P1 執行契約；docs/P2-spec.md ← P2；docs/P3-spec.md ← P3
etl/                   ← ingestion + jobs（Elo / fixtures / alias / odds / predict / simulate / calibrate）
  sql/schema.sql       ← Postgres DDL（P0/P1 §3 + P2 §2 + P3 §3）
  simulate.py          ← P2 Monte Carlo 模擬 job（讀 DB → 引擎 → 寫 group_sim）
  data/raw/elo/        ← Elo CSV（third-party，git-ignored；provenance 見其 README）
  ingest_odds*.py      ← P3 賠率 alias seeding + ingest；model_lines.py / calibrate.py
sources/               ← adapter（RatingSource / FixtureSource / TheOddsApiSource）
engine/                ← Dixon–Coles 引擎（spec §5）+ group_sim.py（P2 純函數模擬）+ value.py（P3 EV/Kelly）
web/                   ← P5 Next.js 前端（App Router + Tailwind + next-intl）
  app/[locale]/        ← 頁面（home / matches / groups / value）；app/api/* ← server route handlers
  lib/                 ← supabaseServer（service key, server-only）/ devig（server）/ value.ts（port, model-free）/ upset / data
  components/          ← ModelVsMarket（並列核心）/ ProbBar / ValueCalculator（client island）/ footers …
  messages/{zh-TW,en}.json  ← UI 字典（key 一一對應）；tests/ ← value/upset/i18n（golden_vectors 由 value.py 生成）
```

## 高風險陷阱（動 code 前先讀；皆已在 spec 處理）
1. **Canonical `team_id` = eloratings `country_code`（兩碼，如 EN/KR/BR）**，**不要 hardcode FIFA 三碼**（CRO vs CRC 之類易錯）。
2. **Elo CSV 含 future-dated 年底欄位**（如 2026-12-31，數值複製自當期 live）。只取「不在未來」的最新快照；直接 `max(snapshot_date)` 會讓 `elo_asof` provenance 變假（數值對、日期錯）。
3. **跨來源隊名一律經 `team_aliases` 解析成 `team_id`**；對不上 → raise，**不准默默新增 team**。
4. **λ 用 log-linear**（spec §5.1），**不要**用加法式 `(total − supremacy)/2`（強弱差大時 λ 變負，Poisson 爆掉）。
5. **主場優勢只給地主三國**（US/CA/MX）且 `is_host_home=true` 時施加；v1 一律 `false`（中立），HFA 先驗 +100 Elo。
6. **We ≠ p_home**：spec 的 64/76/91% 是 win expectancy（含平局）。校正 GAMMA 要對 `We_model = p_home + 0.5·p_draw`，**別拿 p_home 直接對 64%**。
7. **市場效率**：引擎輸出在 UI **必須與市場賠率並列**，不可單獨呈現為「正確答案」。
8. **校正參數（`BASE/GAMMA/HFA_ELO/RHO`）是先驗非真理**，待 P3 backtest 用歷史賽果 + 收盤賠率擬合。
9. **CC BY-SA 4.0**：Elo 資料要標 attribution（網站放 footer）。
10. **淘汰賽賽前 TBD**：賽前 32 場淘汰賽在 football-data 是 **null 隊伍**。fixtures ingest **只收 72 場有隊的小組賽**、跳過未抽籤者；idempotent 重跑會補上。TF1 的「104 列」是賽事期間不變量，賽前實為 72 收 + 32 skip。⚠️ 與 spec §4.2 / TF1 字面不符（已知、刻意；待 spec 對齊）。
11. **手動 alias 在 [etl/identity.py](etl/identity.py) `MANUAL_ALIASES`**：實測只 3 隊需手補（Bosnia-Herzegovina→BA、Cape Verde Islands→CV、Congo DR→CD）。spec §2.2 猜的 Türkiye / Côte d'Ivoire / Korea 其實自動對上；換來源要重驗。
12. **P3 賠率（[docs/P3-spec.md](docs/P3-spec.md)）**：The Odds API 又一套隊名 → `MANUAL_ALIASES_ODDS`（實測只 `Czech Republic`→CZ）。EV 比 **Pinnacle 去 vig** 不比模型；模型機率與 value **程式層隔離**（engine/value.py 不 import 模型）。`odds_snapshots` **變動才存**（以**價格 vs 最新**比對；⚠️ last_update 會空轉、不可當去重鍵，實測 2026-06-09）。totals 模型圖層在 **Pinnacle 實際線**重算（`model_total_lines`），非 `p_over_2_5`。event→match 用無序隊伍對（淘汰賽再遇要時間/輪次硬判）。
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
- 預測（P1）：`python -m etl.predict [--dry-run]`（→ `match_predictions`，model `dc-v1.0`）
- 模擬（P2）：`python -m etl.simulate [--dry-run] [--n 10000] [--seed 42]`（→ `group_sim`，48 隊晉級機率；需先跑 predict）
- Odds alias 種子（P3）：`python -m etl.ingest_odds_aliases [--dry-run]`（需 `ODDS_API_KEY`；**先於** odds ingest）
- Odds ingest（P3）：`python -m etl.ingest_odds [--dry-run]`（1 call/2 credits；含 `model_total_lines` 重算）
- 校正（P3）：`python -m etl.calibrate`（T10 學習線，非 gate；目前 0 已結算）
- 隊名中文種子（P5）：`python -m etl.seed_team_names_zh [--dry-run]`（策展 48 隊 `name_zh`，繁中非機翻；idempotent。Windows console 印中文需 `PYTHONUTF8=1`）
- 不帶 `--dry-run` = 寫入 Supabase，需 `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` + 已套用 [etl/sql/schema.sql](etl/sql/schema.sql)（**P2 `group_sim` / P3 三物件需先在 SQL editor 套用**）。

### P5 前端（在 `web/`，Node ≥ 20 + npm）
- 安裝：`npm install --prefix web`（env 複製 `web/.env.example` → `web/.env.local`，填 `SUPABASE_URL` / `SUPABASE_SERVICE_KEY`）。
- 開發：`npm run dev --prefix web`（http://localhost:3000 → 自動導向 `/zh-TW`）。
- 測試：`npm test --prefix web`（vitest：value parity / upset / i18n key 對齊；離線，38 passed）。
- 建置：`npm run build --prefix web`（含 TS type-check；無 DB creds 也能建——頁面走 graceful 空狀態）。
- 部署：Vercel，Root Directory 設 `web`，secrets 設 `SUPABASE_URL` / `SUPABASE_SERVICE_KEY`（**service key 勿加 `NEXT_PUBLIC_`**）。
