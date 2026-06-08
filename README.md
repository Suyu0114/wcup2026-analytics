# World Cup 2026 Analytics

世界盃 2026 賽事預測與分析平台。以 **World Football Elo** + **Dixon–Coles Poisson** 模型產生
1X2、大小分、BTTS、爆冷風險等機率輸出，並（後續 phase）與市場賠率並列比對。

> 實作規格：[docs/P0-P1-spec.md](docs/P0-P1-spec.md)　|　工程指南：[CLAUDE.md](CLAUDE.md)

## 狀態
- ✅ 規格 / 專案骨架
- ⬜ **P0** 資料層（schema、Elo / fixtures ingest、identity mapping）
- ⬜ **P1** 預測引擎（Dixon–Coles）
- ⬜ P2–P5（晉級模擬、EV/CLV、球員 props、i18n/UI）

## 資料來源與授權
| 來源 | 用途 | 授權 |
|---|---|---|
| World Football Elo（eloratings.net，via Kaggle） | 球隊 rating | **CC BY-SA 4.0** — 須標註來源 + share-alike |
| football-data.org v4 | 賽程 / 隊伍 / 分組 | 免費 tier（需自行註冊 token） |
| The Odds API（P3） | 市場賠率 | — |

**Elo attribution（CC BY-SA 4.0）**：資料源自 eloratings.net。任何發佈（含網站）須保留來源標註並以相同授權釋出衍生資料 → 網站需放 attribution footer。

## 快速開始
```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1          # Windows PowerShell
pip install -r requirements.txt
Copy-Item .env.example .env         # 填入 token / keys（.env 已被 git-ignore）
```
Supabase schema 套用：執行 [etl/sql/schema.sql](etl/sql/schema.sql)（spec §3 DDL）。

## 結構
```
docs/P0-P1-spec.md     執行契約（唯一真相來源）
etl/                   ingestion jobs
  sql/schema.sql       Postgres DDL
  data/raw/elo/        Elo CSV（third-party，git-ignored）
sources/               資料來源 adapter（RatingSource / FixtureSource）
engine/                Dixon–Coles 引擎
```

## License
程式碼授權：TBD。Elo 衍生資料受 **CC BY-SA 4.0** 約束。
