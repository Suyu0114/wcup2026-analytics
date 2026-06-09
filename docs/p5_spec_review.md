# P5 Spec Review — 完整分析

> 審閱對象：[P5-spec.md](file:///c:/Users/jing8/Desktop/myProject/worldCup2026_analytics/docs/P5-spec.md)  
> 交叉對照：[P0-P1-spec.md](file:///c:/Users/jing8/Desktop/myProject/worldCup2026_analytics/docs/P0-P1-spec.md)、[P3-spec.md](file:///c:/Users/jing8/Desktop/myProject/worldCup2026_analytics/docs/P3-spec.md)、[CLAUDE.md](file:///c:/Users/jing8/Desktop/myProject/worldCup2026_analytics/CLAUDE.md)、[value.py](file:///c:/Users/jing8/Desktop/myProject/worldCup2026_analytics/engine/value.py)、[schema.sql](file:///c:/Users/jing8/Desktop/myProject/worldCup2026_analytics/etl/sql/schema.sql)

---

## 🟢 整體評價

**這份 P5 spec 寫得非常好。** 它清楚延續了 P0–P3 的「執行契約」風格，所有高風險陷阱都有明確對策，decision table 完整，驗收測試（TU1–TU14）覆蓋全面。以下是具體分析。

---

## 一、你的四個問題

### Q1：整體方向與範圍切割 OK 嗎？

**✅ OK，非常好。** 

P5 = 純呈現層 + 雙語，不新增模型/ETL/不寫 DB——這是正確的切割。幾個亮點：

- §0 的「明確不在 P5」列表夠具體（P4 props、淘汰賽 bracket、帳號、live 串流、原始快照傾印），**不會讓實作者自作主張**。
- F1/F3/F4/F5 對應的來源資料和頁面路由清楚列出。
- 「前端不寫 DB」寫得很乾淨——連唯一的例外都明確說「無」。

> [!TIP]
> 唯一可以更明確的：§10「之後（不在 P5）」提到 `a11y / SEO / OG image 收尾、深色模式`——建議在 §0 也加一句「a11y / SEO / OG / dark mode 為 v1.1 收尾，P5 v1 不阻擋」，避免 Claude Code 主動去做。

### Q2：`web/` 子目錄放前端（vs 根目錄）——接受嗎？

**✅ 接受，而且我認為這是正確的選擇。**

理由：
1. **Monorepo 分離**：Python ETL 的 `pyproject.toml` / `requirements.txt` / `.venv` 和 Next.js 的 `package.json` / `node_modules` / `next.config.ts` 完全不交叉。放根目錄會讓兩套依賴管理混在一起。
2. **CI/CD 友善**：Vercel 只部署 `web/`（Root Directory 設 `web`），不會掃到 Python 檔案。
3. **開發體驗**：`cd web && npm run dev` 清晰明瞭；§9 結構樹也已標好。

> [!NOTE]
> 需要在 CLAUDE.md 的「指令」段加上 `cd web && npm run dev`（spec §9 CLAUDE.md [MODIFY] 已提到，但具體內容沒寫——建議實作時補上完整指令段）。

### Q3：§4.3 賠率公開限制——保守度滿意嗎？

**✅ 滿意，保守度恰當。**

你的策略：**只回聚合去 vig 機率 + best-line + line-shopping 清單（≤10 家），不傾印 `odds_snapshots` 全量。**

這是兩層防護的平衡：
- **法律面**：The Odds API [Terms](https://the-odds-api.com/terms/) 禁止 raw odds data redistribution。你回傳的是**衍生值**（去 vig 後的隱含機率）和**聚合比較**（哪家最好），不是原始 decimal_odds 時序列。這在多數 ToS 解讀下是安全的。
- **實用面**：使用者需要的是「哪裡賠率最好、EV 多少」，不需要逐書 raw snapshot。

> [!IMPORTANT]
> 一個可以再緊一個檔的地方：§4.3 response 裡的 `line_shopping` 陣列確實回傳了各書的 **`decimal`（原始賠率）**——嚴格說這還是 raw odds。如果你想更保守，可以：
> - 只回 `book` + `rank`（不給實際數字），前端只顯示「哪家最高」
> - 或者在 UI 限制只顯示前 3 家（best-3），不列全部
>
> 但我認為**目前的做法已經足夠保守**——line-shopping 是使用者輸入自己賠率後的**對照輔助**，且只顯示「同一條線、當前快照」的少量書，不是批量傾印。**維持現狀即可。**

### Q4：首頁 `/[locale]/page.tsx` 的內容？

**建議先保持簡潔。** 你目前的設計「總覽 + disclaimer banner」是對的。具體建議：

```
首頁內容（v1）：
├── Hero：專案名 + 一句話說明 + disclaimer banner（「實驗性模型，非投注建議」）
├── Quick Links：三張卡片
│   ├── 📊 比賽預測 → /matches（F1/F3）
│   ├── 🏆 晉級機率 → /groups（F4）
│   └── 💰 EV 計算機 → /value（F5）
├── 資料新鮮度摘要：elo_asof、最新 odds captured_at、sim computed_at
└── 全站 footer（attribution + 市場效率 + 負責任博弈）
```

**不建議做「今日比賽 feed」**。理由：
1. 你是手動 ingest（非即時），「今日」的概念不精準——可能顯示昨天的未更新資料，反而誤導。
2. v1 不做 live 比分串流，「今日比賽」卡片會看起來像是「應該有即時更新但沒有」。
3. 增加一個新的 API endpoint + 日期篩選邏輯，v1 不值得。

---

## 二、發現的問題與建議（按嚴重度排序）

### 🔴 Issue 1：`odds_closing` view 在 Route Handler 內可能很慢

**位置**：[§4.3](file:///c:/Users/jing8/Desktop/myProject/worldCup2026_analytics/docs/P5-spec.md#L169)（`GET /api/value/market`）

`/api/value/market` 需要讀 Pinnacle 去 vig 機率。去 vig 的輸入是 Pinnacle 某場某 market 的 raw prices——但 spec 沒說從哪張表讀。

**兩個選擇**：
- 直接讀 `odds_snapshots`（取最新的 Pinnacle 快照）→ 每次 query 對 append-only 表做 `DISTINCT ON` 排序，隨快照增加會變慢。
- 用 `odds_closing` view → 但 view 的 `WHERE captured_at <= kickoff_utc` 在賽前剛好 = 全量，也慢。

**建議**：在 Route Handler 裡直接用 `odds_snapshots` 搭配明確 query：

```sql
SELECT DISTINCT ON (bookmaker, market, outcome, coalesce(point, -1))
  bookmaker, market, outcome, point, decimal_odds, captured_at
FROM odds_snapshots
WHERE match_id = $1
ORDER BY bookmaker, market, outcome, coalesce(point, -1), captured_at DESC
```

這只掃特定 `match_id` 的行，有 `odds_snapshots_lookup` index 覆蓋。Spec 可以在 §4.3 加一句 implementation hint。

---

### 🔴 Issue 2：ISR/SSG revalidation 機制未指定

**位置**：[§2](file:///c:/Users/jing8/Desktop/myProject/worldCup2026_analytics/docs/P5-spec.md#L60)

Spec 提到「F1/F3/F4 頁面可 SSG/ISR（配合手動 ingest 後 revalidate）」，但**沒有說明如何觸發 revalidate**。

Next.js ISR 有兩種方式：
1. **Time-based**：`revalidate = 3600`（每小時）
2. **On-demand**：ingest ETL 跑完後打 `POST /api/revalidate?secret=...&path=/matches`

你的 ETL 是手動觸發（`python -m etl.ingest_odds`），不會自動 revalidate Vercel 快取。

**建議**：
- v1 用 **time-based ISR**（如 `revalidate = 1800`，30 分鐘）最簡單，符合「資料變動慢」。
- 或在 spec 加一句「v1 不做 on-demand revalidation；頁面 cache TTL = 30min（可調）」。
- On-demand revalidation 留 v1.1（需在 ETL 加 webhook）。

---

### 🟡 Issue 3：`/api/matches` 的 upset flag 放哪算？

**位置**：[§6.3](file:///c:/Users/jing8/Desktop/myProject/worldCup2026_analytics/docs/P5-spec.md#L254-L265) 和 [§9](file:///c:/Users/jing8/Desktop/myProject/worldCup2026_analytics/docs/P5-spec.md#L331)

Spec 在兩處有矛盾：
- §6.3 說「放 `lib/upset.ts`（**前端**/或 server `/api/matches`）」
- §9 結構寫 `lib/upset.ts — 爆冷規則（閾值可調）`（在 `web/` 下，前端）
- §4.1 response 裡 `model.upset` 由 server 算（「server 算（閾值可調）」）

**建議**：統一放 **server** 比較好。理由：
1. upset 需要 `elo_home`、`elo_away`、`p_home`、`p_draw`——這些都在 server side 有。
2. 在 server 算一次 → response 帶 flag → 前端只管顯示，減少 client bundle。
3. `lib/upset.ts` 可以是一個 server-only utility，被 `/api/matches` route handler import。

---

### 🟡 Issue 4：`value.ts` port 的 `novig` 函數去哪了？

**位置**：[§5.1](file:///c:/Users/jing8/Desktop/myProject/worldCup2026_analytics/docs/P5-spec.md#L203-L219)

`value.py` 裡有 `novig()` 函數（比例正規化），但 §5.1 的 port 對應表沒列它。Spec 明確說「`p_novig` 一律由 server API 提供，client 不重算去 vig」——所以前端確實不需要 `novig()`。

但 **server side 需要它**：`/api/value/market` 要算 `pinnacle_novig`（§4.3）。

**建議**：
- 在 §4.3 或 §9 加一個 `lib/devig.ts`（server-only utility），或直接在 route handler 裡內聯。
- 明確說「`novig` 不進 `value.ts`（client），改放 server-only utility」。

---

### 🟡 Issue 5：缺 error boundary / loading state 規範

整份 spec 對「正常情境」描述得很好，但對以下異常情境沒有 UI 規範：

| 情境 | 建議的 UI 行為 |
|---|---|
| `/api/matches` 回 500 | 顯示錯誤提示 + 重試按鈕，不白屏 |
| Supabase 無法連線 | 顯示 maintenance 訊息 |
| `/value` 選了一場但 server 回 `market: null` | 走 TU3 graceful 路徑（已定義） |
| `name_zh` fallback 全部都是 null | 全站顯示英文 + 一個 banner（「中文隊名準備中」） |
| `group_sim` 表為空（simulate 未跑） | `/groups` 顯示「模擬數據準備中」，不 crash |

**建議**：在 §6 加一節「§6.6 異常 / 空資料 graceful」，至少列出上述情境的預期行為。這對 Claude Code 很重要——它很容易把空資料當 bug 處理（throw）而不是 graceful 顯示。

---

### 🟡 Issue 6：`/api/matches` 回傳的 `best_h2h` 結構可能洩漏 raw odds

**位置**：[§4.1](file:///c:/Users/jing8/Desktop/myProject/worldCup2026_analytics/docs/P5-spec.md#L139)

```jsonc
"best_h2h": { "home": {"book":"draftkings","decimal":1.95}, "draw": {...}, "away": {...} }
```

這裡的 `decimal: 1.95` 是某家書的**原始賠率**——和 §4.3 的 ToS 防護立場（只回聚合去 vig）有些張力。

**不過**，這只是 1X2 的 best-line（3 個數字），不是全量傾印，我認為風險可接受。

**建議**：如果你想一致，可以把 `/api/matches` 的 `best_h2h` 拿掉（那是 `/value` 頁面的事），`/matches` 頁面只顯示 model vs market（去 vig 機率）。但這是 nice-to-have，不是 blocker。

---

### 🟡 Issue 7：`/matches` 的分頁/篩選沒定義

72 場小組賽 + 未來淘汰賽，`GET /api/matches` 一次回全部嗎？

**建議**：v1 一次回全部是可以的（72 場的 JSON 很小），但在 spec 明確說：
- 「v1 不分頁，一次回全部小組賽」
- 前端用 client-side filter（按日期/組別/爆冷）

---

### 🟢 Issue 8：`SITE_TZ` default 的時區顯示考量

**位置**：[§3.4](file:///c:/Users/jing8/Desktop/myProject/worldCup2026_analytics/docs/P5-spec.md#L111)

預設 `Asia/Taipei` 很好（你的主要用戶群）。Spec 也說「同時標 UTC」——這很重要，因為 2026 世界盃在北美舉辦，kickoff 時間可能涵蓋 UTC-8 到 UTC-5。

> [!TIP]
> 考慮加一句：「使用者無法在 v1 切換時區（server env 控制）；v1.1 可改為 client-side detection（`Intl.DateTimeFormat().resolvedOptions().timeZone`）。」

---

### 🟢 Issue 9：`next-intl` 的 middleware 設定未提及

`next-intl` 需要一個 `middleware.ts` 來處理 locale routing（`/` → `/zh-TW/...` 重導向、`Accept-Language` 協商）。Spec §3.1 提到行為但沒提到 middleware 檔案。

**建議**：在 §9 結構加一行 `middleware.ts — next-intl locale routing + 預設 zh-TW`。

---

### 🟢 Issue 10：TU5 黃金向量的具體值在哪？

[§7 TU5](file:///c:/Users/jing8/Desktop/myProject/worldCup2026_analytics/docs/P5-spec.md#L289) 要求 `value.ts` 對 P3 TV1/TV3/TV6/TV8 黃金向量「與 `value.py` 完全一致」。

但 P3 spec 也沒有列出具體的 golden vectors（只定義了公式）。

**建議**：實作時先用 `value.py` 跑一組輸入，把結果寫成 `tests/golden_vectors.json`，然後 vitest 對這個 JSON 比。Spec 可以加一句「黃金向量由 `engine/value.py` 生成，存 `web/tests/fixtures/golden_vectors.json`」。

---

### 🟢 Issue 11：`/value` 頁面的 market/outcome 選擇流程可以更明確

§5.2 步驟 2 寫「選 market（1X2 / 大小分）+ outcome（主/和/客 或 over/under）」，但 totals 還需要選 point（線）。

使用者流程應該是：
1. 選比賽
2. 選 market（1X2 / 大小分）
3. **若 totals → 顯示 Pinnacle 主線 point，使用者確認或輸入自己的 point**
4. 選 outcome
5. 輸入賠率

Spec 在 `evaluate()` 裡有 `point` 參數，但 UI flow 沒有明確 point 的輸入方式。

**建議**：加一句「totals 選擇後，自動帶入 Pinnacle 主線（如 2.25）；使用者可修改 point → 若與主線不同，走 line_mismatch。」

---

### 🟢 Issue 12：`3rd` stage 的處理

[§3.3](file:///c:/Users/jing8/Desktop/myProject/worldCup2026_analytics/docs/P5-spec.md#L103) 的 enum 列了 `3rd`（三四名決賽），但 2026 世界盃確認[取消了三四名決賽](https://en.wikipedia.org/wiki/2026_FIFA_World_Cup)。

**建議**：這不影響 P5（P5 只讀 DB），但如果你想保持嚴謹，可在 §3.3 或 §6.4 加一個 note：「2026 取消三四名決賽；`stage='3rd'` 字典 key 保留但預期無資料。」

---

## 三、交叉對照驗證

| 對照項 | P5 spec | 來源 | ✅/⚠️ |
|---|---|---|---|
| 模型不當答案 | D5 / §6.1 | P0-P1 §1.3 / §7 / CLAUDE.md trap #7 | ✅ 完全對齊 |
| value 只吃 `pinnacle_novig` | D4 / §5.1 | P3 §5.0 / TV4 | ✅ |
| 隊名策展非機翻 | D2 / §3.2 | P0-P1 §3 i18n 註記 | ✅ |
| CC BY-SA attribution | D7 / §6.5 | CLAUDE.md trap #9 | ✅ |
| service key server-only | D3 / §2.1 | CLAUDE.md trap — 未列但正確 | ✅ |
| 淘汰賽 TBD graceful | §6.4 | CLAUDE.md trap #10 | ✅ |
| totals 模型圖層讀 `model_total_lines` | §4.3 | P3 §4.4 / §5.4 | ✅ |
| `value.py` 函數簽名 | §5.1 對照表 | [value.py](file:///c:/Users/jing8/Desktop/myProject/worldCup2026_analytics/engine/value.py) | ✅ 一一對應 |
| schema 不改 | §2.2 | [schema.sql](file:///c:/Users/jing8/Desktop/myProject/worldCup2026_analytics/etl/sql/schema.sql) | ✅ |
| `novig` 不在 port 表 | §5.1 | `value.py` L32–35 | ⚠️ 見 Issue 4 |
| 無 chart lib | D1 | P0-P1 §8 | ✅ |
| 賠率格式轉換 | §5.1 TU7 | P3 §5.6 / TV6 | ✅ |
| Kelly 預設 ¼ | §5.1 | P3 §5.3 / `value.py` L8 | ✅ |
| `odds_closing` view 定義 | §4.3 隱含使用 | P3 §3.2 / [schema.sql](file:///c:/Users/jing8/Desktop/myProject/worldCup2026_analytics/etl/sql/schema.sql#L80-L87) | ⚠️ 見 Issue 1 |

---

## 四、最終判定

> [!IMPORTANT]
> **Spec 通過。可以開始實作。**

核心架構（server-only key、model-free value、model vs market 並列）全部正確。風險清單完整。驗收測試（TU1–14）覆蓋到位。

**實作前建議處理（非 blocker）：**
1. 🔴 在 §4.3 補一句 odds query 的 implementation hint（Issue 1）
2. 🔴 在 §2 補 ISR cache TTL / revalidation 策略（Issue 2）
3. 🟡 統一 upset flag 放 server（Issue 3）
4. 🟡 在 §9 補 `lib/devig.ts`（server-only）和 `middleware.ts`（Issue 4, 9）
5. 🟡 在 §6 補一節空資料 / 錯誤 graceful 規範（Issue 5）

這些可以在開工前花 10 分鐘在 spec 裡加幾行，也可以在實作過程中 Claude Code 碰到時再處理——但前者更穩妥。
