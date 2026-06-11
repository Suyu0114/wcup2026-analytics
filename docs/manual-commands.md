# 手動指令速查表

> 複製貼上即可執行。所有 Python 指令都在**專案根目錄**執行。
> 環境：conda `WC2026`（先 `conda activate WC2026`）。

---

## 工作目錄 & 環境啟動

每次開新 terminal 先跑這兩行：

```bash
conda activate WC2026
cd c:\Users\jing8\Desktop\myProject\worldCup2026_analytics
```

---

## 一、首次 / 資料初始化（按順序跑）

以下指令有依賴順序，**由上而下**執行。

### 1. Elo ratings 匯入

```bash
python -m etl.ingest_elo
```

> 來源：`etl/data/raw/elo/` 的 CSV。加 `--dry-run` 可預覽不寫入。

### 2. 隊名 alias 種子（football-data 來源）

```bash
python -m etl.ingest_aliases
```

> 需要 `FOOTBALL_DATA_TOKEN`。**必須先於 fixtures**。

### 3. 賽程 fixtures 匯入

```bash
python -m etl.ingest_fixtures
```

> 淘汰賽未抽籤前只收 72 場小組賽，抽完重跑會自動補上。

### 4. 隊名中文種子

```bash
python -m etl.seed_team_names_zh
```

> 策展 48 隊繁中名（`name_zh`），idempotent 可重跑。
> Windows console 印中文需先設：`set PYTHONUTF8=1`

### 5. 預測（match_predictions）

```bash
python -m etl.predict
```

> 需先有 fixtures + Elo。產出 1X2 + 大小分機率。

### 6. 模擬（group_sim 晉級機率）

```bash
python -m etl.simulate
```

> 需先跑 predict。預設 10000 次 Monte Carlo。
> 可加參數：`python -m etl.simulate --n 50000 --seed 42`

### 7. 賠率 alias 種子（The Odds API 來源）

```bash
python -m etl.ingest_odds_aliases
```

> 需要 `ODDS_API_KEY`。**必須先於 odds ingest**。不耗 markets credit。

### 8. 賠率匯入（odds ingest）

```bash
python -m etl.ingest_odds
```

> 1 call = 2 credits（月上限 500 credits / 250 calls）。
> 含自動重算 `model_total_lines`。
> ⚠️ 此指令也有 GitHub Actions 每日自動跑（UTC 06:00），手動跑是為了賽前 closing。

### 9. 校正（calibration）

```bash
python -m etl.calibrate
```

> T10 學習線，需要有已結算比賽（`matches.status='final'`）。
> 非模型 gate，每次 run 對所有版本計分並 append `calibration_runs`。

---

## 一之二、賽後 / matchday（每場比賽踢完後跑）

每場小組賽結束後，依序跑這三個指令更新平台。**有依賴順序，由上而下執行。**

### 1. 重匯賽程 + 比分（status + 進球）

```bash
python -m etl.ingest_fixtures
```

> 從 football-data 抓 `status='final'` 與 `score.fullTime` 進球，寫入 `matches.home_goals` / `away_goals`。idempotent 可重跑。
>
> ⚠️ **fd 免費層的賽後資料不可靠**：常把比賽標 `FINISHED` 卻給 null 比分，甚至狀態反覆跳動
> （實測 2026-06-11 開幕戰 537327：`FINISHED`↔`TIMED` 來回、比分一直 null）。
> 此時 ingest **不會中止**，那場會印 `WARNING … no score yet — left UNSETTLED`，暫時維持未結算（顯示賽前機率）。
> 要讓它結算，把**已驗證的真實比分**填進 [etl/results.py](../etl/results.py) 的 `RESULTS`
> （key = match_id，例如 `"537327": (2, 0)`），再重跑本指令。
> 該表是**權威來源**：有填就結算（不管 fd 狀態），fd 之後若給出**不一致**的比分會 **fail-loud 報錯**要你對帳；
> 等 fd 穩定給對的比分後可把該列移除、交還給 fd。

### 2. 重跑模擬（鎖定已結算比賽 → 更新晉級機率）

```bash
python -m etl.simulate
```

> 已結算比賽的真實比分會被鎖定（不再抽樣），重算各隊 `group_sim` 晉級機率。
> summary 會印 `Settled matches: N/72 (locked)`。

### 3. 校正（模型 vs 市場計分）

```bash
python -m etl.calibrate
```

> 對已結算比賽計分（Brier / log-loss）並 append `calibration_runs`。
> 賽事初期 n 還小（< 30），模型模式 Kelly 仍鎖，屬正常。

> **不用每場跑**：
> - `predict` — 每場比賽的 λ 在賽前就固定、不會變；只有**重新擬合模型**（換引擎常數）時才重跑全部。
> - `ingest_odds` — 已有 GitHub Actions 每日 UTC 06:00 自動跑；已踢完的比賽不需要新賠率。

---

## 二、診斷 / 分析（任何時候可跑）

### 市場分歧診斷

```bash
python -m etl.diagnose_market
```

> Read-only，不寫 DB。結果輸出到 `fit/DIAGNOSIS.md`。

### 歷史擬合（離線）

```bash
python -m fit.fit_dc
```

> 結果輸出到 `fit/REPORT.md`。Gate 沒過**不准** bump 引擎常數。

---

## 三、前端（web/）

工作目錄仍在**專案根目錄**，用 `--prefix web`。

### 安裝依賴

```bash
npm install --prefix web
```

> env 複製 `web/.env.example` → `web/.env.local`，填入 `SUPABASE_URL` / `SUPABASE_SERVICE_KEY`。

### 本機開發

```bash
npm run dev --prefix web
```

> http://localhost:3000 → 自動導向 `/zh-TW`

### 測試

```bash
npm test --prefix web
```

> vitest，離線可跑。

### 建置（production）

```bash
npm run build --prefix web
```

> 含 TS type-check。無 DB creds 也能建。

### 重生 golden vectors（⚠️ 開發者才需要，日常運營不用跑）

> 只有在**手動修改 `engine/value.py` 的計算邏輯**（如改 EV 公式、Kelly fraction、賠率轉換）時才需要跑。
> 日常跑 ETL 更新資料（ingest、predict、simulate 等）**完全不需要管這步**。
>
> 用途：`value.py`（Python 參考實作）和 `web/lib/value.ts`（前端 TypeScript port）必須算出一樣的結果。
> 這個指令會用 Python 產生一組標準答案，前端測試會拿 TypeScript 的結果去對，確保兩邊同步。

```bash
set PYTHONPATH=.
python web/tests/fixtures/gen_golden.py
```

---

## 四、Dry-run 模式

所有 Python ETL 指令都支援 `--dry-run`，**預覽但不寫入 Supabase**：

```bash
python -m etl.ingest_elo --dry-run
python -m etl.ingest_aliases --dry-run
python -m etl.ingest_fixtures --dry-run
python -m etl.seed_team_names_zh --dry-run
python -m etl.predict --dry-run
python -m etl.simulate --dry-run
python -m etl.ingest_odds_aliases --dry-run
python -m etl.ingest_odds --dry-run
python -m etl.calibrate --dry-run
```

---

## 五、GitHub Actions 自動排程（參考）

唯一的自動 workflow：`.github/workflows/odds-ingest.yml`

| 觸發 | 說明 |
|---|---|
| `cron: '0 6 * * *'` | 每日 UTC 06:00 自動跑 `python -m etl.ingest_odds` |
| `workflow_dispatch` | GitHub repo → Actions → Odds Ingest → Run workflow（手動觸發） |

需在 GitHub repo **Settings → Secrets** 設定：
- `SUPABASE_URL`
- `SUPABASE_SERVICE_KEY`
- `ODDS_API_KEY`

---

## 六、環境變數清單

`.env` 檔案（git-ignored，勿提交）：

| 變數 | 用途 | 哪些指令需要 |
|---|---|---|
| `FOOTBALL_DATA_TOKEN` | football-data.org API | aliases、fixtures |
| `SUPABASE_URL` | Supabase 連線 | 所有非 dry-run |
| `SUPABASE_SERVICE_KEY` | Supabase service key | 所有非 dry-run |
| `ODDS_API_KEY` | The Odds API | odds aliases、odds ingest |

---

> 最後更新：2026-06-10
