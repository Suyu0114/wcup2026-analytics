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
目前只做 **P0（資料層）+ P1（預測引擎）**。P2–P5（晉級模擬、EV/CLV、球員 props、i18n/UI）不在範圍，**不要提前實作**（見 spec §8）。
- **P0** — Supabase schema、Elo ingest、fixtures ingest、identity mapping。
- **P1** — Dixon–Coles Poisson 引擎 → `match_predictions`（Feature 1：1X2 + 爆冷；Feature 3：大小分）。

## 結構
```
docs/P0-P1-spec.md     ← 執行契約（唯一真相來源）
etl/                   ← ingestion jobs（Elo / fixtures / alias seeding）
  sql/schema.sql       ← Postgres DDL（spec §3）
  data/raw/elo/        ← Elo CSV（third-party，git-ignored；provenance 見其 README）
sources/               ← 資料來源 adapter（RatingSource / FixtureSource）
engine/                ← Dixon–Coles 引擎（spec §5）
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
- 測試：`python -m pytest -q`（離線 25 passed + 1 skipped；TF5 有 Supabase creds 時跑 → 26 passed）
- Elo ingest：`python -m etl.ingest_elo [--dry-run]`（`--dry-run` 連 Supabase 都不需要）
- Alias 種子：`python -m etl.ingest_aliases [--dry-run]`（需 `FOOTBALL_DATA_TOKEN`；**先於** fixtures）
- Fixtures ingest：`python -m etl.ingest_fixtures [--dry-run]`
- 預測（P1）：`python -m etl.predict [--dry-run]`（讀 `teams`+`matches` → 寫 `match_predictions`，model `dc-v1.0`）
- 不帶 `--dry-run` = 寫入 Supabase，需 `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` + 已套用 [etl/sql/schema.sql](etl/sql/schema.sql)。
