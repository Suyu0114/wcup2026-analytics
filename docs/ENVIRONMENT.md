# 開發環境 / Environment

本專案的 conda 虛擬環境設定。給其他 agent / 開發者參考。

## TL;DR

```powershell
conda activate WC2026
python -m pytest -q   # 16 passed 離線；有 Supabase creds 時 TF5 也跑 → 17 passed
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
python -m pytest -q   # 驗收：16 passed（無 creds，TF5 skip）/ 17 passed（有 Supabase creds）
```

> 注意：repo 內另有一個 stdlib `.venv`（Python 3.13），與此 conda env 為兩套並行環境。
> 統一使用 `WC2026` 即可；`.venv` 可忽略或自行刪除。

## macOS（參與者環境）

> 原作者/環境在 Windows（上方為準）。以下為 macOS 參與者在自己機器上重建 `WC2026` 的補充說明，**指令與位置不同，其餘規格（env 名稱、Python 3.13、套件來源）一致**。

| 項目 | 值 |
|------|-----|
| env 名稱 | `WC2026`（同 Windows） |
| Python | 3.13.13（`conda create python=3.13` 取得） |
| 位置 | `/opt/anaconda3/envs/WC2026`（Anaconda3） |

### 從零重建（bash / zsh）

```bash
conda create -n WC2026 python=3.13 -y
conda activate WC2026
python -m pip install -r requirements.txt
# 驗收（cwd = 專案根目錄 wcup2026-analytics/）
python -m pytest -q   # 實測 52 passed（.env 有 Supabase creds；無 creds 時 TF5 自動 skip）
```

> **libmamba solver 修復記錄（2026-06-09，一次性）**：此 Anaconda3 原本每次 `conda` 都會噴 `conda-libmamba-solver ... libarchive.20.dylib` 警告。
> 成因：`libarchive` 曾從 3.7.4（提供 soversion **20**）更新到 3.7.7（提供 soversion **13**），但 `libmamba.2.0.0.dylib` 仍連結 `libarchive.20.dylib` → 找不到。
> 修法（純新增、不動既有 `libarchive.13`、不需 solver 跑 base）：把快取裡 3.7.4 的 dylib 補回 lib：
> ```bash
> cp /opt/anaconda3/pkgs/libarchive-3.7.4-h8f13d7a_0/lib/libarchive.20.dylib /opt/anaconda3/lib/
> ```
> 修好後 libmamba 已恢復為**預設 solver**、警告消失，`conda create` 不再需要 `--solver=classic`。
> （回退：刪掉 `/opt/anaconda3/lib/libarchive.20.dylib` 即還原。）

## 常用指令（皆在 `conda activate WC2026` 後執行）

| 用途 | 指令 | 需要 |
|------|------|------|
| 測試 | `python -m pytest -q` | 離線 16 passed；TF5 需 Supabase creds（缺則自動 skip）→ 17 passed |
| Elo ingest（乾跑） | `python -m etl.ingest_elo --dry-run` | 無 |
| Alias 種子（乾跑） | `python -m etl.ingest_aliases --dry-run` | `FOOTBALL_DATA_TOKEN` |
| Fixtures ingest（乾跑） | `python -m etl.ingest_fixtures --dry-run` | `FOOTBALL_DATA_TOKEN` |
| 實際寫入 Supabase | 去掉 `--dry-run` | `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` + 已套用 [etl/sql/schema.sql](../etl/sql/schema.sql) |

環境變數：複製 `.env.example` → `.env`（git-ignored，勿提交）。詳見 [CLAUDE.md](../CLAUDE.md)。

---
最後更新：2026-06-08（建立 WC2026 conda env；加入並驗收 TF5 後：離線 16 passed / 含 Supabase 17 passed）。
最後更新：2026-06-09（macOS 參與者於 `/opt/anaconda3` 重建 WC2026，Python 3.13.13；含 Supabase creds 實測 52 passed；並修復此機 libmamba solver——補回 `libarchive.20.dylib`，libmamba 已恢復為預設、無警告）。
