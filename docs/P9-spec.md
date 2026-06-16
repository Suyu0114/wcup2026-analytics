# P9-spec — 預測結果單頁（track record）+ 爆冷標籤審計

> 執行契約。與 [CLAUDE.md](../CLAUDE.md) 衝突時，以本檔為準（但**專案硬性原則**
> verify-don't-assume / data-integrity / 市場並列 不可違反）。
> 狀態：**設計定稿、待實作**。

## 0. 背景 / 動機

首頁 **Featured: next matches** 卡片會對每場小組賽顯示 **市場分級風險** 與 **爆冷風險（爆冷）標籤**
（[web/components/FeaturedMatchCard.tsx](../web/components/FeaturedMatchCard.tsx)；徽章
[web/components/UpsetBadge.tsx](../web/components/UpsetBadge.tsx)）。但目前**只能看未來、不能回顧**：

1. 沒有任何頁面記錄「模型賽前預測 vs 實際賽果」的成績（過往預測紀錄）。
2. 沒有檢核「我們標了爆冷風險的場次，最後是否真的爆冷」。

本 P9 新增**一頁** `/track-record`，同時涵蓋上述兩件事。

## 1. 設計總覽（user 已確認）

- **一頁、兩區塊**：`/track-record`。上方=**模型 vs 市場**整體準確度成績單；下方=**爆冷標籤審計**；
  再加**逐場**預測 vs 賽果清單。
- **市場必須並列**（CLAUDE.md 陷阱 #7/#13b 硬規則）：成績單為模型 vs 市場（命中率＋Brier），
  且**每一場**列出模型選邊＋市場熱門＋實際結果（✓/✗）。
- **爆冷「成真」的定義＝兩者都顯示、以 not-lose 為主**：主標命中率用**弱隊不敗**（贏或平——
  與 tier 同一基礎 `notLose = win + draw`，見 [web/lib/upset.ts:39](../web/lib/upset.ts#L39)）；
  **純贏**比率並列；每場標 贏／平／負。
- **範圍＝小組賽**（v1）。預測與爆冷標籤目前只在小組賽出現（`getMatches()` 過濾 `stage='group'`）。
  淘汰賽為日後 trivial 擴充（待淘汰賽預測存在後，拿掉 stage 過濾即可）。
- **不動 schema、不新增 ETL、前端不寫 DB**（P5 契約）。

## 2. 資料正確性前提（已驗證，非臆測）—— 為何不需要 prediction snapshot

爆冷 tier **不落表**，由 [web/lib/data.ts:205](../web/lib/data.ts#L205) `computeUpset()` 以
`teams.elo` + `match_predictions` **即時計算**。疑慮是：模型重跑會覆蓋賽前預測
（`match_predictions` PK `(match_id, model_version)`，upsert——[etl/db.py:307](../etl/db.py#L307)；
`fetch_matches_to_predict` 撈**全部**比賽不分 status——[etl/db.py:54](../etl/db.py#L54)）。

**賽事期間不會發生**：matchday recompute pipeline ＝ `ingest_fixtures → simulate → calibrate`
（＋standings），**刻意不含 `predict` 與 `ingest_elo`**——
[docs/manual-commands.md:147-148](manual-commands.md) 明載「predict — 每場比賽的 λ 在賽前就固定、
不會變；只有**重新擬合模型**（換引擎常數）時才重跑」。故目前 `match_predictions`（`dc-v1.1`）
＋凍結的 `teams.elo` **忠實重現賽前預測與同一個爆冷標籤**（即首頁卡片賽前顯示的那個）。
**結論：不需要 prediction-snapshot 表。**

**UI 註記（footer/footnote）**：預測為凍結之賽前 `dc-v1.1` 模型；未來若**賽中重新擬合**
（bump `model_version`）顯示數字會改變。此為已知、刻意之取捨。

## 3. 資料層

### 3.1 計分輔助 — 新檔 `web/lib/score.ts`
對齊 Python 計分（[etl/calibrate.py:26-39](../etl/calibrate.py#L26)）以與校正 job 一致：
- `result1x2(homeGoals, awayGoals): 'home'|'draw'|'away'`
- `pick(probs): 'home'|'draw'|'away'`——三者 argmax（平手→`home`，於 docstring 載明）
- `brier(probs, outcome): number`

純函數、單元測試。log-loss 可選；主標用 命中率＋Brier 即足。

### 3.2 資料函式 — `getTrackRecord()` 加進 [web/lib/data.ts](../web/lib/data.ts)
Server 函式，回傳**已結算小組賽** join 預測／賠率／賽果。**複用同檔既有 helper**：
`fetchLatestOdds`、`novig`（`./devig`）、`computeUpset`（已 import）。
- 查 `matches`（`stage='group'`）select `...,status,home_goals,away_goals`；只留
  `status='final'` **且** goals 非 null（已結算集合，同
  [etl/calibrate.py:60-62](../etl/calibrate.py#L60) 的 gate）。
- 查 `match_predictions`（過濾 `MODEL_VERSION`）＋ `teams`（elo＋名稱）——同 `getMatches()`
  做法（[web/lib/data.ts:156-167](../web/lib/data.ts#L156)）。
- 每場組一列：模型機率、`pick(model)`、`computeUpset(...)`（tier＋weaker）、市場去 vig
  `novig(pinnacle h2h)` → 市場熱門（無 Pinnacle h2h 則 graceful null）、實際 `result1x2`、
  模型/市場命中旗標。
- **彙總**：模型命中 `X/N` ＋ Brier（全部已結算且有預測）；市場命中＋Brier（已結算且**有 Pinnacle 盤**，
  獨立 `n`，對齊 calibrate 的市場子集計分）；爆冷審計彙總（總體＋分 tier：not-lost 率為主、won 率次之）。
- 全包 try/catch → 失敗回 `unavailable: true`（graceful 空狀態，§6.6）。

### 3.3 型別 — [web/lib/types.ts](../web/lib/types.ts)
新增 `TrackRecordRow`（match meta＋home/away team＋模型機率＋modelPick＋marketPick|null＋
upset {tier, weaker}＋home_goals/away_goals＋actualOutcome＋modelHit/marketHit）與
`TrackRecordResponse`（`{ rows, summary, unavailable }`，`summary` 放彙總）。

## 4. 前端頁面

### 4.1 頁面 — 新檔 `web/app/[locale]/track-record/page.tsx`
完全比照 [results/page.tsx](../web/app/[locale]/results/page.tsx)：`export const dynamic = 'force-dynamic'`、
`setRequestLocale`、`getTranslations`、呼叫 `getTrackRecord()`、`unavailable`/空 → `EmptyState`。三區塊：
- **成績單**：模型 vs 市場 命中率＋Brier（標 settled n）。小而清楚、左右並列。
- **爆冷標籤審計**：主行＝not-lost 命中率（總體＋分 A+/A/B），won 率次之；下接標籤場次清單，
  每場 `UpsetBadge`＋弱隊＋贏/平/負判定 chip。
- **逐場成績清單**：模型選邊＋市場熱門 vs 實際比分，附 ✓/✗。複用 `Flag`、`displayTeamName`、
  比分版面取自 [FixtureRow.tsx](../web/components/FixtureRow.tsx)。

### 4.2 元件
新增展示元件（server/client 皆相容，如 FixtureRow）：`TrackRecordRow.tsx` 與 `UpsetAudit.tsx`
（若夠小可內聯於 page）。複用 `UpsetBadge`、`Flag`、`ProbBar`。

## 5. 導覽 + i18n

- **Nav** — [web/components/SiteHeader.tsx:6-13](../web/components/SiteHeader.tsx#L6)：`NAV_ITEMS`
  加一筆 `{ href: '/track-record', labelKey: 'nav.trackRecord' }`（桌機＋漢堡選單同源，無需他改）。
- **i18n** — [web/messages/en.json](../web/messages/en.json) ＋
  [web/messages/zh-TW.json](../web/messages/zh-TW.json)：加 `nav.trackRecord` 與 `trackRecord`
  namespace（title/subtitle、成績單標籤、爆冷判定 贏/平/負、model/market/actual 表頭、凍結模型註腳）。
  **兩個 locale 都要加**（i18n parity 測試會把關）。

## 6. 測試 — [web/tests/](../web/tests)
- `score.test.ts`：`result1x2`、`pick`（含平手規則）、`brier` 對手算值。
- 擴充爆冷「成真」分類測試（弱隊 贏/平/負）。
- 既有 i18n parity 測試在兩 message 檔補齊前會紅——正是同步守門。

## 7. 驗收 / 驗證

| 項目 | 指令 / 動作 | 期望 |
|------|------------|------|
| build | `npm run build --prefix web` | TS 過；`/track-record` 為 dynamic（不在 prerender-manifest），同 `/results` |
| 測試 | `npm test --prefix web` | score＋upset 綠、i18n parity 綠（84+ passing） |
| 雙語 | dev 開 `/zh-TW/track-record`、`/en/track-record` | 成績單顯示模型 vs 市場 n＋Brier；爆冷審計列出標籤場次與正確 贏/平/負；逐場列出模型/市場選邊 vs 實際＋✓/✗ |
| 空狀態 | 無 creds／無已結算場次 | graceful EmptyState，不 throw |
| 抽查 | 挑一場已結算 | 顯示之爆冷 tier＝賽前卡片所示；not-lost/won 判定與真實比分一致 |

## 8. 範圍外 / 註記
- 無 schema 變更、無新 ETL、無 DB 寫入。
- 無 prediction-snapshot 表（預測賽事期間凍結，§2 已驗證）。
- 淘汰賽延後（日後拿掉 `stage='group'` 過濾即可）。
- 市場逐場用最新 odds snapshot（已結算場次 ≈ closing），與 `getMatches()` 一致；無 Pinnacle h2h
  的場次計入模型 n、排除於市場 n（對齊 [etl/calibrate.py](../etl/calibrate.py)）。

## 9. 檔案清單

| 動作 | 檔案 |
|------|------|
| 新增 | `web/lib/score.ts` |
| 新增 | `web/app/[locale]/track-record/page.tsx` |
| 新增 | `web/components/TrackRecordRow.tsx`、`web/components/UpsetAudit.tsx`（或內聯） |
| 新增 | `web/tests/score.test.ts` |
| 改 | `web/lib/data.ts`（加 `getTrackRecord()`） |
| 改 | `web/lib/types.ts`（加 `TrackRecordRow` / `TrackRecordResponse`） |
| 改 | `web/components/SiteHeader.tsx`（`NAV_ITEMS` 加一筆） |
| 改 | `web/messages/en.json`、`web/messages/zh-TW.json`（`nav.trackRecord` ＋ `trackRecord` namespace） |

---
P9 spec 定稿（待 user OK 後實作）。
