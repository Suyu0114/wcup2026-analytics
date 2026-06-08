# 開發環境 / Environment

本專案的 conda 虛擬環境設定。給其他 agent / 開發者參考。

## TL;DR

```powershell
conda activate WC2026
python -m pytest -q   # 全離線、不需網路/DB，應 16 passed
```

## conda 環境

| 項目 | 值 |
|------|-----|
| env 名稱 | `WC2026` |
| Python | 3.13.x（建立時為 3.13.13） |
| 位置 | `C:\Users\jing8\anaconda3\envs\WC2026` |
| 套件來源 | [requirements.txt](../requirements.txt)（pip 安裝於 conda env 內） |

### Python 版本依據
`requirements.txt` 與 `pyproject.toml` **皆未釘選** Python 版本。版本決策來源：
- 既有的 `.venv` 使用 **Python 3.13.13** → 對齊之以避免行為差異。
- [etl/data/raw/elo/README.md](../etl/data/raw/elo/README.md) 聲明下限 **Python 3.10+** → 3.13 滿足。

若日後 `requirements.txt` 加上明確 `python_requires` 或 pin，請以該規格重建環境並更新本檔。

## 從零重建

```powershell
conda create -n WC2026 python=3.13 -y
conda activate WC2026
python -m pip install -r requirements.txt
python -m pytest -q   # 驗收：16 passed
```

> 注意：repo 內另有一個 stdlib `.venv`（Python 3.13），與此 conda env 為兩套並行環境。
> 統一使用 `WC2026` 即可；`.venv` 可忽略或自行刪除。

## 常用指令（皆在 `conda activate WC2026` 後執行）

| 用途 | 指令 | 需要 |
|------|------|------|
| 測試 | `python -m pytest -q` | 無（全離線） |
| Elo ingest（乾跑） | `python -m etl.ingest_elo --dry-run` | 無 |
| Alias 種子（乾跑） | `python -m etl.ingest_aliases --dry-run` | `FOOTBALL_DATA_TOKEN` |
| Fixtures ingest（乾跑） | `python -m etl.ingest_fixtures --dry-run` | 無 |
| 實際寫入 Supabase | 去掉 `--dry-run` | `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` + 已套用 [etl/sql/schema.sql](../etl/sql/schema.sql) |

環境變數：複製 `.env.example` → `.env`（git-ignored，勿提交）。詳見 [CLAUDE.md](../CLAUDE.md)。

---
最後更新：2026-06-08（建立 WC2026 conda env，pytest 16 passed）。
