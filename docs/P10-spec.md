# World Cup 2026 Analytics — P10 Spec

> 給 Claude Code 的實作規格 / 「執行契約」。**P10 = 賽中 Elo 更新 + dc-v1.2 重新預測 + UI 版本切換器。**
> 風格遵循專案原則：**verify-don't-assume**、**data integrity over approximation**、**fail-loud**、**idempotent**、**provenance**。對齊 [P0-P1-spec.md](P0-P1-spec.md)、[P6-spec.md](P6-spec.md)、[P5-spec.md](P5-spec.md)、[CLAUDE.md](../CLAUDE.md)。
> **本檔尚未實作；待 user review 通過後才動 code**（沿 P5 慣例）。
> ⚠️ 本 spec **修訂**了 P6 §1.8 的「UI 單版本」條款（§7 修訂清單）。修訂理由見 §0 動機。
> 📝 **v2（2026-06-17）**：已併入可行性 review 修正——3 個關鍵問題 **B1**（track-record 釘 `BASELINE_VERSION`）/ **B2**（i18n dot-free key）/ **B3**（value 經 client API route），加 **C** 事實更正（與現況 code 對齊）與 **D** groups 裁決。各處標 `B1/B2/B3/C/D`，完整摘要見文末。

---

## 0. Scope / 動機

**dc-v1.1 的限制**：預測在賽前凍結（72 場一次產生），recompute pipeline 不含 `predict` / `ingest_elo`。模擬（`simulate`）會因 D3 鎖定反映已結算比分，但**個別未踢比賽的預測機率不會更新**。

**dc-v1.2 要解決什麼**：第一輪結束後，eloratings.net 已反映賽事結果的即時 Elo。dc-v1.2 用**同一引擎常數**（BASE/GAMMA/HFA/RHO 不變）+ **更新後的 Elo 快照**，重新預測**尚未結算的比賽**。使用者在 UI 可切換比較 v1.1（賽前）和 v1.2（第二輪更新）的預測差異。

**後續可複製**：同機制可在第三輪前再產 dc-v1.3（只需再更新 Elo + bump 版本 + re-predict），不需重新設計。

**明確不在 P10：**
- 不改引擎擬合常數（不跑 `fit/fit_dc.py`；需要重新擬合走 P6 A2 流程）。
- 不新增「情境調整」（must-win 等行為因子——缺乏校準基礎）。
- 不碰 P4 球員 props。
- 不碰淘汰賽預測（淘汰賽 fixtures 為 TBD）。

---

## 1. Decisions（user 裁決 2026-06-16）

1. **dc-v1.2 語義 = 同引擎常數 + 新 Elo 快照**。不重新擬合。
2. **Elo 來源 = eloratings.net**（手動下載更新 CSV 到 `etl/data/raw/elo/`，走既有 `CsvRatingSource` pipeline）。
3. **只重新預測尚未結算的比賽**（`status != 'final'`）。已結算比賽不產 v1.2 prediction row（結果已知，預測無意義）。
4. **UI 版本切換器 = 全域**，影響 matches / groups / value / home 四大頁面。
5. **修訂 P6 §1.8**：從「UI 永遠只呈現單一 active 版本」改為「UI 預設最新版本，提供版本切換器」。理由：dc-v1.1 是賽前基線，保留可比較價值；目標使用者（親友團）在教學後可理解「賽前 vs 更新」。

---

## 2. 資料層 — Elo 更新

### 2.1 Elo CSV 更新流程

eloratings.net 是 JavaScript 渲染（無法直接 HTTP 抓）。操作者需**手動**：

1. 在 eloratings.net 確認 48 隊的最新 Elo（排名頁可看全部）
2. 更新 `etl/data/raw/elo/elo_ratings_wc2026.csv`：
   - 對 48 隊更新 `rating` 欄位為最新值
   - 更新 `snapshot_date` 為操作日期（如 `2026-06-22`）
   - **不可**加新列，直接改既有列的 rating + snapshot_date（保持 48 列結構）
3. 跑 `python -m etl.ingest_elo`：驗證 T0 gate（48 隊、無 NaN、日期不在未來）→ upsert `teams.elo` + `teams.elo_asof`

**或者**，在 CSV 中新增一排新日期的快照列——`CsvRatingSource` 會自動取「不在未來的最新 snapshot」（既有邏輯 [sources/rating_source.py:66-75](../sources/rating_source.py#L66)）。

> ⚠️ **provenance**：`elo_asof` 必須反映真實的 Elo 快照日期（即你抓資料那天）。`ingest_elo` 的 T0 gate 會攔截未來日期。

### 2.2 陷阱

1. **eloratings.net 的 Elo 在賽事期間每場更新**：抓取時機很重要——建議在某一輪完全結束後的次日抓，避免半輪更新造成不一致。
2. **48 隊 team_id mapping 不變**：Elo CSV 的 `country_code` = 既有 canonical `team_id`，不會因為更新而改變。
3. **`teams.elo` 更新後是全域的**：所有讀 `teams.elo` 的地方都會拿到新值（包括首頁的 Elo 排名展示、爆冷 gap 計算）。但 `match_predictions` 裡的 `lambda_home/away` 是 predict 時算好存入的，**不會因為 teams 表改了而自動變**——必須重跑 predict 才行。

---

## 3. 後端 — 預測引擎版本化

### 3.1 版本常數

#### [MODIFY] [engine/dixon_coles.py](../engine/dixon_coles.py)

```python
# 改動前
MODEL_VERSION = "dc-v1.1"

# 改動後
MODEL_VERSION = "dc-v1.2"
# dc-v1.2: same fitted constants as v1.1, updated Elo snapshot (post-R1).
# Predicts only unsettled matches. Settled matches retain v1.1 predictions.
```

**引擎常數（BASE/GAMMA/HFA/RHO）不動。** 版本號只反映 Elo 輸入不同。

### 3.2 predict.py 增加 --only-unsettled

#### [MODIFY] [etl/predict.py](../etl/predict.py)

新增 `--only-unsettled` flag：

```python
def run(dry_run: bool = False, only_unsettled: bool = False) -> list[dict]:
    elos = db.fetch_team_elos()
    matches = db.fetch_matches_to_predict(only_unsettled=only_unsettled)
    # ... 既有邏輯不變
```

CLI：
```
python -m etl.predict --only-unsettled          # 只預測未結算比賽
python -m etl.predict --only-unsettled --dry-run  # 乾跑
```

#### [MODIFY] [etl/db.py](../etl/db.py)

`fetch_matches_to_predict()` 加入 filter：

```python
def fetch_matches_to_predict(only_unsettled: bool = False) -> list[dict]:
    """Matches with both teams set. If only_unsettled, skip status='final'."""
    q = (
        get_client()
        .table("matches")
        .select("match_id,home_team,away_team,is_host_home,is_host_away")
    )
    if only_unsettled:
        q = q.neq("status", "final")
    return q.execute().data
```

### 3.3 simulate.py 支援 model-version 參數

#### [MODIFY] [etl/simulate.py](../etl/simulate.py)

新增 `--model-version` CLI flag：

```python
def run(dry_run=False, n=10_000, seed=None, model_version=None):
    mv = model_version or MODEL_VERSION
    raw_matches = db.fetch_group_matches_with_predictions(model_version=mv)
    # ... 既有邏輯用 mv 取代 MODEL_VERSION
```

#### [MODIFY] [etl/db.py](../etl/db.py) — `fetch_group_matches_with_predictions` 放寬驗證

**關鍵改動**：dc-v1.2 只預測未結算比賽，所以已結算比賽**沒有 v1.2 prediction row**。但模擬仍然需要全部 72 場（已結算用真實比分 D3）。

```python
def fetch_group_matches_with_predictions(model_version: str = "dc-v1.0") -> list[dict]:
    # ... matches 撈取不變（仍要 72 場）

    # Join + validate（放寬：已結算比賽允許沒有該版本的 prediction）
    for m in matches:
        mid = m["match_id"]
        pred = pred_map.get(mid)
        is_settled = m["status"] == "final"
        if pred is None and not is_settled:
            raise ValueError(
                f"Match {mid} has no prediction for model {model_version} (fail-loud)"
            )
        if is_settled:
            if m["home_goals"] is None or m["away_goals"] is None:
                raise ValueError(...)
        result.append({
            ...
            # 已結算 + 無 prediction → lambda 用 0（不會被讀到，D3 鎖定）
            "lambda_home": float(pred["lambda_home"]) if pred else 0.0,
            "lambda_away": float(pred["lambda_away"]) if pred else 0.0,
            "is_settled": is_settled,
            ...
        })
```

> ⚠️ **lambda 用 0.0 作 placeholder**：已結算比賽的 lambda 在模擬中**永遠不會被讀到**（D3 用 `np.full(N, real_score)`），但欄位不可為 null（downstream 型別保證）。用 0.0 而非 NaN 是避免 numpy 操作靜默傳播。`engine/group_sim.py` 的 D3 路徑在 `if m.is_settled:` 中完全跳過 lambda → 安全。

### 3.4 model_lines（P3 totals 線格）

`model_total_lines` 也有 `model_version` 欄位（PK = `match_id, point, model_version`）。predict 重跑後，需一併重算 v1.2 的 totals 線格。

走法：`ingest_odds` 跑線格重算時，讀 `match_predictions` 中 active version 的 lambda → 已結算比賽沒有 v1.2 lambda → **只算有 v1.2 prediction 的比賽**（未結算）的線格。這與既有邏輯一致（`fetch_match_lambdas(model_version)` 只回傳有該版本 prediction 的 match）。

不需額外改動——`ingest_odds` 在 `MODEL_VERSION` bump 後重跑即可。

### 3.5 calibrate

`etl/calibrate.py` 既有邏輯已對 **DB 內所有 model_version 同批計分**（P6 TA5）。dc-v1.2 列進入 `match_predictions` 後，下次 `calibrate` 會自動計分 v1.2（只計**同時有 prediction + 已結算**的交集）。

**dc-v1.2 初期 n_settled 會是 0**（因為只預測未結算比賽）。隨著比賽結束、score 被計入。

不需改動。

---

## 4. 前端 — 版本切換器

### 4.1 常數 + 版本清單

#### [MODIFY] [web/lib/constants.ts](../web/lib/constants.ts)

```typescript
// Active model version — latest; bump together with engine.dixon_coles.MODEL_VERSION (P6 TA5).
export const MODEL_VERSION = 'dc-v1.2';

// Frozen pre-tournament baseline. Track-record + the v1.1 switcher label pin to THIS,
// NOT to MODEL_VERSION — so bumping the active version never re-points settled-match
// queries at a version that has no settled-match predictions (B1 regression guard, §4.4).
export const BASELINE_VERSION = 'dc-v1.1';

// All deployable model versions (newest first). Used by ModelVersionSwitcher.
// i18nKey is dot-free on purpose: next-intl splits message keys on '.', so a literal
// 'dc-v1.1' key resolves as nested dc-v1 → 1 and fails (B2, §4.3). Map id → dot-free key here.
export const MODEL_VERSIONS = [
  { id: 'dc-v1.2', i18nKey: 'v1_2' },
  { id: 'dc-v1.1', i18nKey: 'v1_1' },
] as const;
export type ModelVersionId = (typeof MODEL_VERSIONS)[number]['id'];
```

### 4.2 版本切換器元件

#### [NEW] `web/components/ModelVersionSwitcher.tsx`

**Client component**（因為涉及 URL navigation）。

設計規格：
- 水平 pill/tab 列（**樣式**參考 MatchFilters 的 chip；⚠️ MatchFilters 是 **local React state、非 URL 導航**，只能抄樣式、不能抄行為——codebase 內無現成 URL-param 導航元件可複製），不是 dropdown
- 每個 pill = 版本標籤（如「v1.2 第二輪更新」/「v1.1 賽前預測」）
- 切換方式 = URL searchParam `?v=dc-v1.1`（預設 = 最新版本，URL 不帶 `v` param）
- `useRouter` + `useSearchParams` + `usePathname`；**用 `new URLSearchParams(searchParams)` 複製既有 param 後再 `set('v', …)`**——保留 value 頁的 `?match/?market/?outcome`，不可整段覆蓋（B3）
- 選中狀態 = 實心高亮 + 微動畫
- 版本標籤走 i18n（**dot-free key**，見 §4.3 B2）

> ⚠️ **URL-based state**（非 React state）：用 searchParam 確保 server component 可讀到版本參數，data fetch 發生在 server 端。用 `useRouter().replace(url, { scroll: false })` 保持 shallow navigation（不觸發 full page load、不跳頁首）。

### 4.3 版本標籤 i18n

#### [MODIFY] `web/messages/zh-TW.json` + `web/messages/en.json`

新增 `modelVersion` namespace（⚠️ **B2：key 不可含 `.`**——next-intl 以 `.` 為巢狀路徑分隔，`t('dc-v1.1')` 會被當成 `dc-v1`→`1` 而解析失敗。用 dot-free key，搭配 §4.1 `MODEL_VERSIONS` 的 `i18nKey` mapping）：

```jsonc
// zh-TW（注意：`common.modelVersion` 已有同名「字串」key，被 MatchCard / groups 用；
//        這裡新增的是獨立 top-level namespace，路徑不同不衝突）
"modelVersion": {
  "label": "模型版本",
  "v1_1": "v1.1 賽前預測",
  "v1_2": "v1.2 第二輪更新"
}

// en
"modelVersion": {
  "label": "Model Version",
  "v1_1": "v1.1 Pre-tournament",
  "v1_2": "v1.2 Round 2 Update"
}
```

> switcher 取標籤：``const { i18nKey } = MODEL_VERSIONS.find(v => v.id === id)!; t(`modelVersion.${i18nKey}`)``。zh-TW / en 必須同步加（過 i18n parity test TU1）。

### 4.4 data.ts 參數化

#### [MODIFY] [web/lib/data.ts](../web/lib/data.ts)

需要切版本的函數加入可選 `modelVersion` 參數（預設 = `MODEL_VERSION` 最新版）：

```typescript
export async function getMatches(modelVersion?: string) {
  const mv = modelVersion ?? MODEL_VERSION;
  // ... 既有邏輯，把 .eq('model_version', MODEL_VERSION)
  //     改為 .eq('model_version', mv)
}
```

影響清單（實測 **6 處** `.eq('model_version', MODEL_VERSION)`，**非 8**——已對齊現況 code）：

| # | 函數 | line | 處理 |
|---|------|------|------|
| 1 | `getMatches()` | 172 | 加 `modelVersion?` 參數 |
| 2 | `getGroups()` | 264 | 加 `modelVersion?` 參數 |
| 3 | `fetchCalibration()`（內部 helper，被 `getValueMarket` 呼叫） | 392 | 跟著 `getValueMarket` 的 mv 走 |
| 4 | `getValueMarket()` model_h2h | 460 | 加 `modelVersion?` 參數 |
| 5 | `getValueMarket()` model_total_lines | 515 | 加 `modelVersion?` 參數 |
| 6 | `getTrackRecord()` | 617 | **釘 `BASELINE_VERSION`、不參數化**（B1 regression guard） |

> ⚠️ **B1（track-record 回歸）**：`getTrackRecord()`（line 617）目前用 `.eq('model_version', MODEL_VERSION)`。若 bump 常數到 dc-v1.2 又不釘版本，settled 比賽沒有 v1.2 pred → 每列被 `if (!pred) continue`（data.ts:646）跳過 → **整頁空白**。改釘 `BASELINE_VERSION`（賽前凍結基線），與 active 版本解耦；`trackRecord.frozenNote` 文案同樣釘 `BASELINE_VERSION`。

> ⚠️ **修正先前 spec 誤植**：`getValueData` 與獨立 export 的 `getCalibration` **不存在**。真實函數是 `getValueMarket(matchId, market, outcome)`，`fetchCalibration(client)` 是其內部 helper（非 export）。先前清單的 `getMatches:202`（scoreline fallback）與 `getGroups:288 return` 兩處也不存在。

**函數簽名改為**（只有要切版本的才加；`getTrackRecord` 簽名不變、內部釘 `BASELINE_VERSION`）：
```typescript
export async function getMatches(modelVersion?: string): Promise<MatchesResponse>
export async function getGroups(modelVersion?: string): Promise<GroupsResponse>
export async function getValueMarket(
  matchId: string, market: 'h2h' | 'totals', outcome: string, modelVersion?: string,
): Promise<ValueMarketResponse>
// getTrackRecord(): Promise<TrackRecordResponse>  ← 不變；內部 .eq('model_version', BASELINE_VERSION)
```

### 4.5 Page components 傳遞版本參數

#### [MODIFY] 所有受影響的 page.tsx（4 頁）

每頁從 `searchParams` 讀 `v`，傳入 data 函數 + 渲染 `ModelVersionSwitcher`：

```tsx
// 共通 pattern（以 matches/page.tsx 為例）
export default async function MatchesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ v?: string }>;
}) {
  const { locale } = await params;
  const { v: modelVersion } = await searchParams;
  // ...
  const { matches, unavailable } = await getMatches(modelVersion);
  // ...
  return (
    <div>
      <ModelVersionSwitcher current={modelVersion} />
      {/* ... 既有 UI */}
    </div>
  );
}
```

受影響頁面：

| 頁面 | 檔案 | data 流 | 備註 |
|------|------|---------|------|
| `/matches` | `web/app/[locale]/matches/page.tsx` | `getMatches(mv)` | 現簽名僅 `{ params }`，需補 `searchParams` |
| `/groups` | `web/app/[locale]/groups/page.tsx` | `getGroups(mv)` | 同上 |
| `/value` | `web/app/[locale]/value/page.tsx` | server：`getMatches(mv)`（選單 + `divergenceList`）；**model/EV 經 client API**：page → `ValueCalculator` → `/api/value/market?…&v=` → `getValueMarket(…, mv)` | **已有 `searchParams`**（`?match/?market/?outcome`）——switcher 必須 merge `?v`、不可覆蓋 |
| home `/` | `web/app/[locale]/page.tsx` | `getMatches(mv)` | home **不呼叫 `getGroups`**（實為 `getMatches`+`getManualResults`+`getFreshnessSummary`）；版本只影響 featured 卡的模型機率 |

> ⚠️ **B3（value 經 client API route）**：value 頁的模型/EV 不是 server 端直呼 `getValueData`，而是 `ValueCalculator`（client）打 [web/app/api/value/market/route.ts](../web/app/api/value/market/route.ts) → 內部呼 `getValueMarket`。版本參數需**多串一條**：page searchParam → `ValueCalculator` prop → API query `?v=` → route handler → `getValueMarket(…, mv)`。注意實際路徑是 `value/page.tsx`（用 `?match` searchParam 選場次），**非** `value/[matchId]/page.tsx`。

> ⚠️ **caching**：`/matches`、`/groups` 現為 `export const revalidate = 1800`（ISR 30 分）。一旦讀 `searchParams` → Next.js 自動轉 dynamic、失去 ISR。matchday 求新鮮可接受，但建議**明確**改 `export const dynamic = 'force-dynamic'`（與 home / track-record 一致），別讓它隱性切換。

> ⚠️ **`/results`、`/standings`、`/track-record` 不加切換器**：results / standings 是事實頁（`matches` 比分 + `group_standings`，無 version 維度）；track-record 是「回顧賽前預測 vs 結果」，**釘 `BASELINE_VERSION`**（§4.4 B1），語義固定為賽前基線。

### 4.6 已結算比賽在切版本時的行為

**核心規則**：dc-v1.2 只有未結算比賽的 prediction。當使用者切到 v1.2 時：
- **未結算比賽**：顯示 v1.2 的機率（更新後的 Elo 計算）
- **已結算比賽**：`match_predictions` 中沒有 v1.2 row → 該比賽不顯示模型機率（graceful 空狀態，已有機制——P5 §6.6）

**matches 頁**特殊處理：已結算比賽顯示真實比分（來自 `matches` 表），不管版本切換。模型機率區塊為空即可（與 P5 的 graceful 設計一致）。

**groups 頁**：`group_sim` 有 `(team_id, model_version)` PK，v1.1 / v1.2 共存。**D 裁決（2026-06-17）：每輪對 v1.1 與 v1.2 都各跑一次 `simulate --model-version …`**——兩者都吃當下 settled 鎖定（D3），只差未結算用各自版本的 λ → `?v=dc-v1.1` ⇄ 預設的 groups 差異**純反映 Elo 更新**（不混入「已結算鎖定」這個變因）。v1.1 **不**重新 predict（pred 仍凍結），只是 sim 吃進新結果。

**value 頁**：已結算比賽的 value 計算無意義（市場已關盤），不管版本。

---

## 5. 執行流程（操作順序）

### 5.1 code 修改（一次性）

```
1. engine/dixon_coles.py    — bump MODEL_VERSION → "dc-v1.2"（+ provenance 註解）
2. web/lib/constants.ts     — MODEL_VERSION → "dc-v1.2"、新增 BASELINE_VERSION、MODEL_VERSIONS（含 dot-free i18nKey）
3. etl/predict.py           — 新增 --only-unsettled flag
4. etl/db.py                — fetch_matches_to_predict(only_unsettled)、放寬 fetch_group_matches_with_predictions
5. etl/simulate.py          — 新增 --model-version flag
6. web/components/ModelVersionSwitcher.tsx  — 新元件（merge searchParams + replace scroll:false）
7. web/lib/data.ts          — 6 處：getMatches/getGroups/getValueMarket 加 modelVersion 參數；getTrackRecord 釘 BASELINE_VERSION（B1）
8. web/app/api/value/market/route.ts + ValueCalculator — 串 ?v= → getValueMarket(…, mv)（B3）
9. web/app/[locale]/{matches,groups,value,page}.tsx  — 讀 searchParams.v + 渲染 ModelVersionSwitcher
10. web/messages/{zh-TW,en}.json  — modelVersion namespace（dot-free key，B2）
11. CLAUDE.md               — 更新 §指令 + §現況
```

### 5.2 資料更新（每輪一次）

```
1. 手動更新 Elo CSV（從 eloratings.net）          # provenance：snapshot_date = 抓取日
2. python -m etl.ingest_elo                        # upsert teams.elo（T0 gate 擋未來日期）
3. python -m etl.predict --only-unsettled          # 寫入 dc-v1.2 predictions（只未結算）
4. python -m etl.simulate --model-version dc-v1.2  # v1.2 sim（settled D3 鎖定 + 未結算新 λ）
5. python -m etl.simulate --model-version dc-v1.1  # v1.1 sim 重跑：吃當下 settled 鎖定（D 裁決）
6. python -m etl.ingest_odds                       # 含 model_total_lines 重算（active 版本）
7. python -m etl.calibrate                         # scores v1.1 + v1.2
```

> ⚠️ **provenance**：dc-v1.2 的 prediction 對 `(match_id, model_version)` upsert——同一輪內若再抓一次 Elo 重跑 predict，會**原地覆寫** v1.2，"dc-v1.2" 不釘定某個 Elo 快照（calibration 因此不可完全重現）。請每輪只在「該輪全部結束後」抓一次（§8 #1），所用快照即當下 `teams.elo_asof`。

### 5.3 未來第三輪（dc-v1.3）——同機制

```
1. 再更新 Elo CSV
2. Bump MODEL_VERSION → "dc-v1.3"（Python + TS）；BASELINE_VERSION 不變（仍 dc-v1.1）
3. MODEL_VERSIONS 加一個 entry（id + dot-free i18nKey 如 v1_3）
4. messages 加 v1_3 標籤（zh-TW / en 同步）
5. ingest_elo → predict --only-unsettled → simulate（對 v1.1/v1.2/v1.3 各跑一次，都吃 settled 鎖定）→ ingest_odds → calibrate
```

---

## 6. 驗收 / 驗證

| 項目 | 指令 / 動作 | 期望 |
|------|------------|------|
| **T-predict** | `python -m etl.predict --only-unsettled --dry-run` | 只列出 status≠final 的比賽數量；不含已結算比賽 |
| **T-sim** | `python -m etl.simulate --dry-run` | 正常跑完 72 場（已結算 D3 鎖定 + 未結算用 v1.2 λ）；不 raise「missing prediction」 |
| **T-coexist** | DB 查詢 `select model_version, count(*) from match_predictions group by model_version` | v1.1 有 72 行、v1.2 有（72 − 已結算）行 |
| **T-calibrate** | `python -m etl.calibrate --dry-run` | 同批計分 v1.1 + v1.2；v1.2 初期 n_settled=0 是正常 |
| **pytest** | `python -m pytest -q` | 全綠（既有測試不 break） |
| **build** | `npm run build --prefix web` | TS type-check 過 |
| **test-web** | `npm test --prefix web` | ≥84 passed（新增 i18n key parity） |
| **UI-default** | dev 開 `/zh-TW/matches` | 預設顯示 v1.2 預測；切換器顯示「v1.2 第二輪更新」高亮 |
| **UI-switch** | 點切換器 → v1.1 | URL 變 `?v=dc-v1.1`；比賽預測機率切回賽前值 |
| **UI-groups** | `/groups?v=dc-v1.1` vs `/groups` | 晉級機率在兩版本間有差異；因 v1.1 也吃了 settled 鎖定（§5.2 step 5），差異**純反映 Elo 更新** |
| **UI-graceful** | `/matches?v=dc-v1.2` 看已結算比賽 | 比分照常顯示、模型機率區塊 graceful 空（不 crash） |
| **UI-trackrec** | bump 後開 `/zh-TW/track-record` | **仍顯示 v1.1 已結算列、非空白**（B1 釘 BASELINE_VERSION 生效；此頁無切換器） |
| **UI-value** | `/value?match=…` 切 `?v=dc-v1.1` ⇄ 預設（model 模式） | 模型機率/EV 隨版本變（驗 API route `?v=` 串通，B3） |
| **UI-params** | 在 `/value?match=X&market=h2h` 點切換器 | URL 變 `…&v=dc-v1.1`，**`match`/`market` 不被洗掉**（merge searchParams） |

---

## 7. 修訂清單（P6 → P10）

| 條款 | 原文 | 修訂 |
|------|------|------|
| P6 §1.8 | 「UI 永遠只呈現單一 active 模型版本… 不做使用者可切換的雙模型」 | **改為**：UI 預設最新版本（dc-v1.2），提供 `ModelVersionSwitcher` 供使用者切換比較。影響頁面：matches / groups / value / home。**不加切換器**：results / standings（事實頁、無 version 維度）+ track-record（有 version 維度但**釘 `BASELINE_VERSION` 賽前基線**，§4.4 B1）。 |
| P9 §2 | 「predict — 每場比賽的 λ 在賽前就固定、不會變」 | **補充**：dc-v1.2 起，`predict --only-unsettled` 可在賽中用新 Elo 重新預測未結算比賽。已結算比賽的 v1.1 預測仍凍結（歷史紀錄用途）。 |

---

## 8. 陷阱清單

1. **Elo 更新的時機**（§2.2 #1）：eloratings.net 每場賽後即時更新。建議在**某一輪全部結束後**的次日統一抓取，避免半輪更新造成不一致。
2. **teams.elo 是全域的**（§2.2 #3）：更新 Elo 後，首頁的 Elo 排名、爆冷 gap 計算都會反映新值。但 `match_predictions` 裡的 λ 是 predict 時寫入的，**不會自動變**。
3. **已結算比賽無 v1.2 prediction**（§3.3 + §4.6）：`fetch_group_matches_with_predictions` 必須放寬驗證，允許已結算比賽沒有該版本 prediction。Lambda placeholder 用 0.0（D3 路徑不讀 lambda，安全）。
4. **searchParams 傳遞**（§4.5）：Next.js App Router 的 `searchParams` 是 server component 可讀的 `Promise`。確保版本參數從 page → data function 一路傳到 Supabase query。**value 頁例外**：model/EV 走 client API route（B3），版本要再經 `/api/value/market?v=`；且 value 頁已有 `?match/?market/?outcome`，switcher 要 **merge、不可覆蓋**（§4.2）。
5. **calibrate n_settled 初期為 0**（§3.5）：dc-v1.2 只有未結算比賽的 prediction，初始 n_settled=0 是正常行為（因為尚無「v1.2 有 prediction 且 match 已結算」的交集）。隨著比賽結束會自動增長。
6. **版本常數 bump 必須 Python + TS 同步**（CLAUDE.md #8）：`engine/dixon_coles.py` 的 `MODEL_VERSION` 和 `web/lib/constants.ts` 的 `MODEL_VERSION` 必須**同一個 commit 一起改**。
7. **🔴 track-record 釘 `BASELINE_VERSION`、不加切換器**（B1 / §4.4）：⚠️ **bump 全域 `MODEL_VERSION` 本身就會打爆 track-record**——`getTrackRecord()`（data.ts:617）若跟著 active 版本跑，settled 比賽無 v1.2 pred → 每列被 `if (!pred) continue`（data.ts:646）跳過 → 整頁空白。必須釘 `BASELINE_VERSION='dc-v1.1'`、與 active 解耦；`frozenNote` 文案同。
8. **🔴 i18n dot-free key**（B2 / §4.3）：next-intl 以 `.` 為巢狀路徑分隔，版本標籤 key 不可寫 `"dc-v1.1"`（會被當成 `dc-v1`→`1`、解析失敗）。用 `v1_1`/`v1_2`，靠 `MODEL_VERSIONS[].i18nKey` mapping。
9. **🔴 value 模型/EV 走 client API route**（B3 / §4.5）：不是 server 直呼 `getValueData`（此函數不存在）。版本需 page → `ValueCalculator` → `/api/value/market?v=` → `getValueMarket(…, mv)` 全鏈串通。
10. **資料流盤點以 code 為準**（C 區更正）：data.ts 實為 **6 處** `.eq('model_version', …)`（非 8）；無 `getValueData`／獨立 `getCalibration`（實為 `getValueMarket` + 內部 `fetchCalibration`）；home **不**呼叫 `getGroups`；4 頁中目前只有 `value/page.tsx` 讀 `searchParams`；value 路徑是 `value/page.tsx`（非 `value/[matchId]`）。

---

## 9. 檔案清單

| 動作 | 檔案 | 說明 |
|------|------|------|
| **改** | `engine/dixon_coles.py` | `MODEL_VERSION` → `"dc-v1.2"` + provenance |
| **改** | `web/lib/constants.ts` | `MODEL_VERSION` + **`BASELINE_VERSION`** + `MODEL_VERSIONS`（id + dot-free `i18nKey`） |
| **改** | `etl/predict.py` | `--only-unsettled` flag |
| **改** | `etl/db.py` | `fetch_matches_to_predict(only_unsettled)` + `fetch_group_matches_with_predictions` 放寬 |
| **改** | `etl/simulate.py` | `--model-version` flag |
| **新增** | `web/components/ModelVersionSwitcher.tsx` | Client component，pill/tab；merge searchParams + `replace(scroll:false)` |
| **改** | `web/lib/data.ts` | **6 處**：`getMatches`/`getGroups`/`getValueMarket` 加 `modelVersion?`；**`getTrackRecord` 釘 `BASELINE_VERSION`**（B1） |
| **改** | `web/app/api/value/market/route.ts` | 收 `v` query → `getValueMarket(…, mv)`（B3） |
| **改** | `web/components/ValueCalculator.tsx` | 帶上 `v`，API 呼叫加 `?v=`（B3） |
| **改** | `web/app/[locale]/matches/page.tsx` | 讀 searchParams + ModelVersionSwitcher |
| **改** | `web/app/[locale]/groups/page.tsx` | 同上 |
| **改** | `web/app/[locale]/value/page.tsx` | 同上（**非 `value/[matchId]`**；merge `?v` 與既有 `?match` 等） |
| **改** | `web/app/[locale]/page.tsx` | 同上（home；只 `getMatches(mv)`，不 `getGroups`） |
| **改** | `web/messages/zh-TW.json` | `modelVersion` namespace（dot-free key，B2） |
| **改** | `web/messages/en.json` | `modelVersion` namespace（dot-free key，B2） |
| **改** | `CLAUDE.md` | §現況 + §指令更新 |

---

P10 spec v2（2026-06-17 併入可行性 review 修正）。修訂摘要：**B1** track-record 釘 `BASELINE_VERSION`（bump 常數不再清空該頁）；**B2** i18n 改 dot-free key（next-intl `.` 路徑陷阱）；**B3** value 模型/EV 經 client API route 串版本；**C** 事實更正（data.ts 6 處非 8、`getValueMarket` 非 `getValueData`、home 不呼叫 `getGroups`、value 路徑 `value/page.tsx`、只 value 頁現讀 searchParams）；**D** 裁決 v1.1 每輪重跑含 settled 鎖定（groups 差異純反映 Elo）。待 user OK 後實作。
