# International Football Results 1872–2026 (martj42)

Historical full-international ("A" match) results used by the **P6 A2 historical
fit** (`fit/fit_dc.py`) to calibrate the Dixon–Coles engine parameters
(`BASE/GAMMA/HFA_ELO/RHO`). See [docs/P6-spec.md](../../../../docs/P6-spec.md) §2.2.

## Provenance

| 項目 | 內容 |
|---|---|
| Source | Kaggle `martj42/international-football-results-from-1872-to-2017`（標題實為 *1872 to 2026*）；upstream GitHub: <https://github.com/martj42/international_results> |
| License | **CC0-1.0**（public domain；GitHub repo LICENSE 驗證 2026-06-10） |
| Downloaded | 2026-06-09（user 手動下載放入本目錄） |
| Coverage | 1872 → 2026（**含尚未開賽的 WC2026 賽程列，比分為 `NA`** — 用前必過濾） |

## Files（git-ignored；本 README 留 repo）

| File | Rows (data) | 用途 |
|---|---|---|
| `results.csv` | ~49,450 | **fit 主檔**。`date, home_team, away_team, home_score, away_score, tournament, city, country, neutral` |
| `shootouts.csv` | ~677 | PK 大戰結果（fit 不用） |
| `goalscorers.csv` | ~47,601 | 進球明細（fit 不用） |
| `former_names.csv` | 36 | 隊名沿革（fit 用現代名，2010+ 樣本窗已避開大多數改名） |

## ⚠️ 比分定義（fit 陷阱 #3）

Upstream 原文：*"full-time home team score **including extra time**, not including
penalty-shootouts."* → 淘汰賽 90 分鐘打平的場次，比分含延長賽進球。對 2010+
樣本占比 <1%，BASE 偏差量化於 `fit/REPORT.md`，接受並記錄（P6 §2.2.6 #3）。

## ⚠️ 其他用前須知

- **未來場次列**：WC2026 賽程已收錄（72 列，比分 `NA`，2026-06-11 起）。
  fit 一律 `dropna(subset=score)` + 只取已完賽日期。
- 隊名為**現代慣用名**（與 Elo CSV 的 `country` 不完全一致，如
  `Czech Republic` vs `Czechia`）→ 經 fit script 內建 alias 表對應，fail-loud。
- `neutral` 欄位：TRUE = 中立場。地主場次 FALSE（WC2026 的 9 場地主賽即此，
  P6 A1 的 venue 策展亦取自這些列，cross-checked vs football-data + Wikipedia）。
