# `/guide` 教學頁 — 規格與實作紀錄

> 給 Claude Code 的實作規格 / 紀錄。`/guide` = 雙語（zh-TW / en）教學頁，由淺入深解釋 EV 計算機背後的概念，對象 = 台灣親友 + 加拿大親友。
> 原規劃寫在外部 `UIUXupdate001_implementation_plan.md`；**本檔為併入 2026-06-10 review 修正後的單一真相來源**。
> 對齊 [P5-spec.md](P5-spec.md) §3、[P6-spec.md](P6-spec.md) §3.6/§3.8/§6、[CLAUDE.md](../CLAUDE.md)。風格沿專案：**verify-don't-assume**、**fail-loud**、**i18n key 一一對應**、**不新增模型/ETL、前端不寫 DB**。

---

## 0. Scope / 現況

`/guide` 是**純前端教學頁**（靜態，無 DB）。**兩批交付**（sequencing 裁決 = 方案 A，見 §1 D1）：

| 批次 | 內容 | 狀態 |
|---|---|---|
| **批次 1** | Ch1 模型 / Ch2 賠率格式（+ OddsConverter）/ Ch3 vig；nav + `/value` banner 入口 | ✅ 已實作（commit `0a8c458`） |
| **批次 2** | Ch4 EV / bankroll / Kelly；Ch5 EV 計算機逐步操作 | ✅ 已實作（2026-06-10，P6 B `/value` 上線後依實際 UI 撰寫） |

**明確不在 /guide：** 新模型 / ETL、P4 球員 props、賠率原始資料、投注建議（教學定位，非促銷）。

---

## 1. Decisions（含 review 修正）

| # | 決策 | 理由 / 來源 |
|---|---|---|
| **D1** | **拆兩批（方案 A）**：Ch1–3 穩定先做；Ch4–5 等 P6 B | Ch4/Ch5 教的是 EV/Kelly/計算機操作，正是 **P6 B 要改版的東西**（雙模式、三級 🟢🟡🔴、Kelly 校正解鎖閘、totals 線格、在地化）。現在寫必重工。 |
| **D2** | **術語一律用 P6 §3.6 策展白話** | guide 與計算機 UI 必須講同一套話：`vig`→「水錢 / 抽水」、`de-vig`→「扣除抽水後的公平機率」、`EV`→「期望值（每注 100 平均賺賠）」。禁自創平行術語。 |
| **D3** | **OddsConverter 反向換算放 `lib/oddsFormat.ts`，不進 `value.ts`** | `value.ts` 只有 `toDecimal`（X→decimal），**沒有 decimal→X**。轉換器需反向函數 → 新增 `fromDecimal`，**刻意放 oddsFormat.ts** 保 `value.ts` 是 `engine/value.py` 忠實 port（不擴面、不重生 golden_vectors）。 |
| **D4** | **i18n 長文用 JSON array**（非 MDX） | 段落/bullet 走 `messages/*.json` 的字串陣列，`t.raw()` 讀取。TU1 key parity 自然 guard「兩語 bullet 數一致」。不引入 MDX pipeline。⚠️ next-intl 型別不收 array → provider 邊界 cast（見 `tests/testUtils.tsx`）。 |
| **D5** | **想法 #1（每場 → EV 計算機）與 P6 §3.7/B6「分歧場次清單」共用同一預填入口** | 別做兩套。統一 `/value?match=…&market=…&outcome=…`，`ValueCalculator` 初始 state 從 searchParams 讀。 |
| **D6** | `oddsfmt.american`（en）→ `American (Moneyline)`；中文維持「美式盤」 | 加拿大用戶更易辨識；對齊 P6 §3.6（en 第二順位 = American）。 |

> **D5 框架紅線（守 D5/trap #7）**：`/matches` 的按鈕**只預填「比賽」、不預填特定 outcome**（一場比賽沒有單一「該下的注」）；文案用「**用 EV 計算機比對你的賠率**」非「這場有 value」。B6 分歧清單才預填特定 outcome（它有明確最大分歧 outcome），且帶「分歧大≠value、多半模型錯」免責行。

---

## 2. 章節內容（5 章；Accordion）

Accordion = 原生 `<details>/<summary>`（免 JS、a11y 友善、各章獨立展開）。

### Ch1 — 我們的預測模型怎麼運作？〔批次 1 ✅〕
Elo 評分（eloratings.net）→ Dixon–Coles（Poisson + 低分相依修正 ρ + 時間權重）→ 比分機率表 → 1X2 / 大小分 → Monte Carlo 晉級機率（10,000 次）。結尾**實驗性聲明**（守 D5/trap #7）。

### Ch2 — 賠率格式：你看到的數字代表什麼？〔批次 1 ✅〕
歐洲盤（Decimal，**台灣運彩即此**）/ 美式盤（American / Moneyline）/ 香港盤。隱含機率 = `1 ÷ 賠率`。
**內嵌 OddsConverter**：輸入任一格式 → 即時顯示其他 4 種 + 隱含機率（`toDecimal` + `fromDecimal`）。

### Ch3 — 什麼是 vig（水錢 / 抽水）？〔批次 1 ✅〕
莊家內建利潤 → 隱含機率加總 > 100% → 去 vig 壓回 100%＝公平機率。
**敘事紅線**（review 修正）：數字範例用**台灣運彩牌價**（高水，125.2% overround）教 de-vig 概念，但要講清楚——**計算機去 vig 的是 Pinnacle（sharp、低水），不是你自己那本**；你輸入的台灣運彩價是拿去**跟 Pinnacle 公平機率比**。

### Ch4 — 什麼是 EV？怎麼讀紅黃綠燈？+ bankroll/Kelly〔批次 2 ✅〕
`EV = (公平機率 × 賠率) − 1`；三級 🟢🟡🔴（含 🟡 仍是負 EV 的明示）；每注 100 / 打平勝率讀法；bankroll 定義；¼ Kelly（例：1,000 × 3.2% = 32）；**模型模式 Kelly 校正解鎖閘**（n≥30 且 Brier≤市場×1.1，P6 §3.5）的白話解釋。
數字範例用單一公平機率 40%（合理賠率 2.50）貫穿三級：2.70→🟢+8% / 2.45→🟡−2% / 2.30→🔴−8%，並用 2.30 示範打平勝率 43.5% vs 公平 40%。

### Ch5 — EV 計算機逐步操作〔批次 2 ✅〕
8 步對照**實際上線的 P6 雙模式 UI**（依 [ValueCalculator.tsx](../web/components/ValueCalculator.tsx) 逐元素核對）：分歧清單入口（含「非 value 清單」警語）→ 機率來源切換（市場預設）→ 選比賽 → market/outcome → totals 線規則（市場 line-mismatch ⇄ 模型 1.5–4.5 線格）→ 格式/賠率/資金 → 結果卡片（三級/每注100/打平/Kelly 閘/比價）→ 近似值標籤解讀。
結尾「三件事永遠成立」框：無 Pinnacle 盤不出 EV、模型永標實驗+並列、僅供參考。

---

## 3. 元件 / 檔案

```
web/app/[locale]/guide/page.tsx     [✅] Server Component，讀 i18n（t.raw 取 bullet 陣列）；批次 1 三章 + 批次 2 佔位連結
web/components/GuideSection.tsx     [✅] <details>/<summary> 可摺疊章節（presentational）
web/components/OddsConverter.tsx    [✅] client island；toDecimal + fromDecimal；錯誤 graceful
web/lib/oddsFormat.ts               [✅] fromDecimal（decimal→各格式）；display-only、不進 value 路徑
web/components/SiteHeader.tsx       [✅] nav 加「教學 / Guide」
web/app/[locale]/value/page.tsx     [✅] 頂部 banner → /guide
web/messages/{zh-TW,en}.json        [✅] guide namespace（array bullets）+ nav.guide + value.guidePrompt；en oddsfmt.american 改名
web/tests/oddsFormat.test.ts        [✅] 13：黃金向量反向 round-trip + 邊界 + throw
web/tests/OddsConverter.test.tsx    [✅] 2：預設 decimal 2.5 → 其他格式 + 40.0%；無效賠率 graceful
```

批次 2（✅ 2026-06-10）：`messages/{zh-TW,en}.json` 加 `guide.ev` + `guide.calculator` namespace（more* 佔位改完結語）；`guide/page.tsx` 加兩個 GuideSection（Ch5 用 `<ol>` 編號步驟 + 注意事項框）。
`/value` searchParams 預填已由 P6 B6 實作（分歧清單 → 計算機）；**想法 #1 的 /matches 每場按鈕仍未做**——日後要做時走同一個 `/value?match=…` 入口（D5 紅線：只帶 match 不帶 outcome）。

---

## 4. 驗收（沿 P5 §7 / P6 §7 慣例）

| 項 | 條件 |
|---|---|
| i18n parity | guide namespace zh-TW/en key 一一對應；array bullet 數一致（TU1 既有測試涵蓋） |
| OddsConverter | `fromDecimal` 為 `toDecimal` 反函數（黃金向量 round-trip）；無效輸入 graceful 不 crash |
| 呈現 | 三 Accordion 可獨立展開；雙語文字完整；轉換器互動正常（component test + 人工） |
| build | `/guide` 兩語 SSG；TS type-check 過 |

---

## 5. review 修正紀錄（2026-06-10）

1. **Sequencing**：guide 教的 Ch4/Ch5 正是 P6 B 要改版的 UI（雙模式 / 三級 / Kelly 閘 / 線格 / 在地化）→ 裁決**方案 A 拆兩批**（D1）。
2. **OddsConverter 反向缺口**：`value.ts` 只有 `toDecimal`，轉換器需 decimal→X → 補 `lib/oddsFormat.ts fromDecimal`，不污染 value.ts（D3）。
3. **想法 #1 ↔ P6 B6 synergy**：每場按鈕與分歧清單共用 `/value?match=…` 預填；按鈕只預填比賽、文案非「有 value」（D5）。
4. **台灣運彩格式**：P6 §3.6 已確認 = **歐洲盤（decimal）**——原 Open Question 結案。
5. **Ch3 vig 敘事**：去 vig 的是 **Pinnacle** 不是使用者那本，邏輯鏈要講清楚（§2 Ch3）。
6. **i18n 長文架構**：JSON array vs MDX → 選 **JSON array**（TU1 guard bullet 數）（D4）。
7. **術語**：一律用 P6 §3.6 策展白話（D2）；`American (Moneyline)` 改名（D6）。
8. **台灣運彩 logo**：跳過，用文字「台灣運彩」（免商標/資產風險）。

---
guide-spec 建立 2026-06-10（批次 1 = commit `0a8c458`）；批次 2 完成 2026-06-10（P6 B `/value` 上線後依實際 UI 撰寫）。/guide 五章全數上線。
