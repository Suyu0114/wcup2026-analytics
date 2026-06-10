# World Cup 2026 Analytics — P5 Spec

> 給 Claude Code 的實作規格 / 「執行契約」。**P5 = i18n（zh-TW / en）+ Web UI**——把已完成的 P1/P2/P3 模型與市場資料呈現給使用者。
> 風格遵循專案原則：**verify-don't-assume**、**data integrity over approximation**、**fail-loud**、**idempotent**、**provenance**。對齊 [P0-P1-spec.md](P0-P1-spec.md) §1/§3/§7、[P2-spec.md](P2-spec.md)、[P3-spec.md](P3-spec.md) §5、[CLAUDE.md](../CLAUDE.md)。
> **本檔尚未實作；待 user review 通過後才動 code。**

---

## 0. Scope

**P5 = 前端呈現層（zh-TW / en 雙語）。** 把 DB 既有資料（P0–P3 已寫入）轉成可讀的網站，**不新增模型、不新增 ETL**。

呈現的既有交付：

| Feature | 來源資料 | 頁面 |
|---|---|---|
| **F1 1X2 + 爆冷** | `match_predictions.p_home/p_draw/p_away` + `teams.elo` | `/matches` |
| **F3 大小分 / BTTS** | `match_predictions.p_over_2_5 / p_btts / exp_total_goals` | `/matches` |
| **F4 晉級機率** | `group_sim.p_first/p_second/p_third_qual/p_advance` | `/groups` |
| **F5 EV / value 計算機** | `odds_closing`（Pinnacle 去 vig）+ `model_total_lines` + `engine/value.py` 算術 | `/value` |
| 市場賠率並列 | `odds_snapshots` 最新 / line-shopping ≤10 家 | `/matches`、`/value` |

**明確不在 P5：**
- **新模型 / 新 ETL job**：P5 只讀 DB，不重算、不寫入（唯一例外：無，前端不寫 DB）。
- **P4 球員 props（Feature 2）**：UI **不得**出現球員 props 區塊（尚未實作；見 P0-P1 §0）。
- 淘汰賽 bracket / 奪冠機率（P2 未做）：淘汰賽 32 場賽前是 TBD（trap #10），UI **graceful 顯示「待抽籤」**，不臆造。
- 使用者帳號 / 下注紀錄 / 個人 CLV（P3 v1 無下注 log，見 P3 §10）。
- 即時推播 / live 比分串流（v1 靠手動 ingest + 頁面 refresh）。
- 賠率原始快照公開傾印（ToS 風險，見 §4.3）。
- **a11y / SEO / OG image / dark mode 為 v1.1 收尾**，P5 v1 不阻擋、不主動實作（基本語意 HTML + 可讀對比即可）。

---

## 1. Decisions locked

| # | Decision | 理由 |
|---|---|---|
| D1 | **Next.js（App Router）+ Tailwind + Supabase JS，部署 Vercel** | user 選定。Supabase 主流組合；Tailwind 橫條 + 排序表（**無 chart lib**，對齊 P0-P1 §8）。 |
| D2 | **雙語 zh-TW（預設）/ en 全站切換**（`next-intl`，locale routing `/[locale]/…`） | user 選定。UI 字串走 dictionary；**隊名走 DB 策展查表**（`name_zh`/`name_en`），**非機器翻譯**（P0-P1 §3 i18n 註記）。 |
| D3 | **資料存取走 server-side API 層（service key）** | user 選定。`SUPABASE_SERVICE_KEY` **只在 server**（Route Handlers / Server Components）；**絕不進 client bundle**。前端不直連 Supabase。 |
| D4 | **EV「使用者賠率 → 算 EV」算術留前端**（`lib/value.ts`，port `engine/value.py`，**model-free**）；**市場去 vig 機率由 server 算好回傳** | 守 P3 §5.0（前端只做使用者賠率算術）+ P3 §1.2 / TV4（value 路徑只吃 `pinnacle_novig`，模型機率程式層隔離）。 |
| D5 | **模型輸出永遠與市場賠率並列 + 標「實驗性」**；**絕不單獨呈現為「正確答案」** | 硬性，守 P0-P1 §1.3 / §7 / CLAUDE.md trap #7。無市場時只秀模型 + 更顯眼的實驗性標籤，且不出 value。 |
| D6 | **read-only 網站**（無帳號、無寫入） | v1 範圍；前端對 DB 只讀。 |
| D7 | **Elo attribution（CC BY-SA 4.0）+ 市場效率聲明 + 負責任博弈聲明**全站常駐 footer | 守 CLAUDE.md trap #9 / README 授權義務 / P3 §5.5 responsible footer。 |

---

## 2. 架構

```
Browser ──▶ Next.js (Vercel)
              ├─ app/[locale]/…           Server Components（SSR/SSG，讀 server API/直連 server client）
              ├─ app/api/*  (Route Handlers, server-only)
              │     └─ supabaseServer (SUPABASE_SERVICE_KEY) ──▶ Supabase
              └─ client islands：/value 的 EV 計算機（lib/value.ts，純前端算術）
```

- **service key 只在 server**：`lib/supabaseServer.ts` 用 `SUPABASE_SERVICE_KEY`（**無 `NEXT_PUBLIC_` 前綴** → 不進 client bundle）。client 元件**不得** import 它。
- **client 端唯一的資料動作** = 使用者在 `/value` 輸入自己的賠率 → `lib/value.ts` 算 EV/Kelly（市場去 vig 機率事先由 server API 給）。
- **無 chart lib**：所有機率視覺化 = Tailwind 橫條（`<div>` width %）+ 可排序 `<table>`。
- 渲染策略：F1/F3/F4 頁面 **time-based ISR**（`revalidate = 1800`，30 分鐘，可調；資料變動慢）；`/value` 的市場端點走 SSR/動態（`cache: 'no-store'`，賠率較新鮮）。
- **revalidation（Issue 2）**：v1 **只做 time-based ISR**，不做 on-demand。ETL 是手動觸發（`python -m etl.ingest_*`），不打 Vercel revalidate webhook。**on-demand revalidation（ingest 後 `POST /api/revalidate?secret=…`）留 v1.1。**

### 2.1 環境變數（前端，設於 Vercel Project Settings）

| 變數 | 用途 | 暴露面 |
|---|---|---|
| `SUPABASE_URL` | Supabase 專案 URL | server-only（亦可前綴 public，URL 非機密） |
| `SUPABASE_SERVICE_KEY` | server read（service key） | **server-only，嚴禁 `NEXT_PUBLIC_`**（TU11 檢查） |
| `SITE_TZ`（選） | 顯示時區，預設 `Asia/Taipei` | — |

> **不需要** `ODDS_API_KEY`：賠率已由 P3 ETL ingest 進 DB，前端只讀 DB，不打 The Odds API。

### 2.2 schema 影響

- **v1 不需要新 RLS policy**：存取全走 server service key（service key bypass RLS）。`etl/sql/schema.sql` **不改**。
- 縱深防禦（**選配**，非 gate）：可在 Supabase 對各表 `enable row level security` + 不建任何 policy（= client anon 一律拒絕）。因前端不用 anon，影響為零；留作日後若改 anon 直連的保險。**spec 不要求 v1 做。**

---

## 3. i18n 設計

### 3.1 機制

- `next-intl`，locale routing：`/zh-TW/…`（預設）、`/en/…`。`/` 重導向至預設 locale 或依 `Accept-Language` 協商。
- UI 字串字典：`messages/zh-TW.json`、`messages/en.json`。**禁止 hardcode 顯示字串**（TU1）。
- 兩字典 **key 必須一一對應**（CI lint：缺 key → fail，fail-loud 精神）。

### 3.2 隊名（⚠️ 策展，非機器翻譯）

```
displayTeamName(team, locale):
    if locale == 'zh-TW': return team.name_zh ?? fallback(team.name_en)   # name_zh 可能為 null
    else:                 return team.name_en
```

- **zh-TW 用 `teams.name_zh` 策展查表**（西班牙/阿根廷/法國…），**不得**對 `name_en` 做機器翻譯（P0-P1 §3 / trap：國名機翻會錯）。**已實作**：48 隊繁中由 [etl/seed_team_names_zh.py](../etl/seed_team_names_zh.py) 策展種子（idempotent、fail-loud 覆蓋檢查）。
- `name_zh` 為 null → fallback `name_en` 並在 UI 標記（待人工補；**不靜默假裝有中文**）。TU1 驗 fallback 不 crash。
- 隊碼 `team_id`（兩碼 country_code）是內部 key，**不直接給使用者看**。
- **國旗（視覺輔助）**：`flag-icons` SVG（**非 emoji**——Windows 不渲染 emoji 國旗會變兩碼字）。`team_id → flag code` 經 [web/lib/flag.ts](../web/lib/flag.ts)：**team_id ≠ 全等 ISO-3166**，實測 48 隊只 `EN→gb-eng`、`SQ→gb-sct` 兩 override，其餘 `lowercase`。國旗 `aria-hidden`（隊名才是語意內容）。用於 [MatchCard](../web/components/MatchCard.tsx) / [GroupTable](../web/components/GroupTable.tsx)；`<select>` 無法放 SVG → value 頁下拉維持純文字。

### 3.3 enum / 標籤字典化

| 類別 | 來源值 | 字典 key 範例 |
|---|---|---|
| stage | `group/r32/r16/qf/sf/3rd/final` | `stage.group` = 小組賽 / Group Stage（⚠️ 2026 取消三四名決賽；`3rd` key 保留但預期無資料——Issue 12） |
| confederation | `UEFA/CONMEBOL/…` | `conf.UEFA` |
| market | `h2h/totals` | `market.h2h` = 1X2 |
| outcome | `home/draw/away/over/under` | `outcome.home` = 主勝 |
| 賠率格式 | `decimal/hongkong/american/indonesian/malaysian` | `oddsfmt.hongkong` = 香港盤 |

### 3.4 日期 / 數字

- `kickoff_utc`（timestamptz）→ 依 `SITE_TZ`（預設 `Asia/Taipei`）+ locale 格式化；**同時標 UTC** 供跨時區對照（provenance）。2026 在北美舉辦（UTC-8~-5），UTC 標註尤其重要。
- v1 使用者**不能切時區**（server env 控制）；v1.1 可改 client-side detection（`Intl.DateTimeFormat().resolvedOptions().timeZone`）（Issue 8）。
- 機率一律顯示為百分比（如 `64.2%`）；賠率顯示 decimal（並保留使用者輸入格式回顯）。

---

## 4. Server API 層（Route Handlers，service key）

通則：**只讀**、**fail-loud**（缺資料回明確錯誤而非靜默空）、**provenance 一起回**（as-of / model_version / captured_at）。回傳 **model 與 market 欄位明確分離**（守 D5 隔離）。

### 4.1 `GET /api/matches`

讀 `matches`（已存的小組賽）+ `match_predictions`（`dc-v1.0`）+ 各場最新市場賠率（≤10 家，含 Pinnacle）。**v1 不分頁，一次回全部小組賽**（72 場 JSON 很小）；篩選（日期/組別/爆冷）走 **client-side**（Issue 7）。

```jsonc
// 回傳（每場一物件）
{
  "match_id": "...", "stage": "group", "group_label": "F",
  "kickoff_utc": "2026-06-13T18:00:00Z",
  "home": { "team_id":"BR", "name_en":"Brazil",  "name_zh":"巴西", "elo": 2030 },
  "away": { "team_id":"KR", "name_en":"Korea Republic", "name_zh":"南韓", "elo": 1790 },
  "model": {                          // ⚠️ 實驗性；不可單獨當答案（D5）
    "model_version": "dc-v1.0",
    "p_home": 0.58, "p_draw": 0.24, "p_away": 0.18,
    "p_over_2_5": 0.55, "p_btts": 0.51, "exp_total_goals": 2.7,
    "upset": { "flag": false, "weaker": "KR" }   // §6.3 規則，**server 算**（lib/upset.ts，server-only；Issue 3）
  },
  "market": {                         // 可能為 null（沒上盤 → graceful，D5/§6.1）
    "pinnacle_novig": { "home": 0.55, "draw": 0.25, "away": 0.20 },  // 三邊 Σ=1（P3 §5.1，server 用 lib/devig.ts）
    "best_h2h": { "home": {"book":"draftkings","decimal":1.95}, "draw": {...}, "away": {...} },
    "freshness": { "captured_at":"2026-06-12T06:00:00Z", "last_update":"...", "stale": false }
  }
}
```

- `model` 與 `market` 分屬不同物件 → 前端無法「混用」（TU6 隔離）。`upset` 由 **server** 算（`lib/upset.ts` server-only，閾值可調；統一於 server，前端只顯示——Issue 3）。
- `pinnacle_novig` 由 **server `lib/devig.ts`**（比例正規化）算（Issue 4）。
- `best_h2h`（1X2 best-line，3 個數字）是 `/value` line-shopping 的輕量前置；非全量傾印，ToS 風險可接受（Issue 6）。`/matches` 主視覺仍是 model⇄market 的**去 vig 機率**並列，不以 raw decimal 為主角。
- 沒上盤的場次 `market: null`（**不報錯**，graceful，§6.1）。
- 淘汰賽 32 場賽前未存（trap #10）→ 不在此清單；`/matches` 另列「待抽籤」區塊（§6.4 / TU4）。

### 4.2 `GET /api/groups`

讀 `group_sim`（48 列）+ `teams`（隊名）。可附目前實際積分（已結算場次）供賽中對照。

```jsonc
{
  "model_version": "dc-v1.0", "sim_n": 10000, "computed_at": "...",   // provenance（P2 §2）
  "groups": {
    "F": [
      { "team_id":"BR", "name_zh":"巴西", "name_en":"Brazil",
        "p_first":0.62, "p_second":0.21, "p_third_qual":0.10, "p_advance":0.93 },
      ...4 隊
    ], ...A..L
  }
}
```

- 每組 4 隊；`p_first` 組內加總 ≈ 1（P2 TS1）。前端按 `p_advance` 排序橫條。
- `sim_n` / `computed_at` / `model_version` 一定顯示（provenance；TU10）。

### 4.3 `GET /api/value/market?match_id&market&outcome[&point]`

供 `/value` 取**市場端**（去 vig 機率 + line-shopping + 模型實驗圖層 + 新鮮度）。**使用者賠率算術不在此**（在 client，§5）。

```jsonc
{
  "match_id": "...", "market": "totals", "outcome": "over",
  "pinnacle_main_point": 2.25,          // totals 才有（P3 §2 主線定義）
  "pinnacle_novig": 0.49,               // 該 outcome 去 vig 機率（P3 §5.1）；value 只吃這個
  "is_quarter_line": true,              // 2×point 非整數 → EV/Kelly 近似（P3 §5.2/§5.3）
  "best_available": { "book":"pinnacle", "decimal": 2.02 },  // 同一條線內比（P3 §5.5 / TV7）
  "line_shopping": [ {"book":"pinnacle","decimal":2.02}, {"book":"betmgm","decimal":1.98} ],
  "model_layer": {                      // ⚠️ 實驗性、與 value 隔離（P3 §5.4 / TV5）
     "model_version":"dc-v1.0", "point":2.25, "p_over":0.52, "p_under":0.48
  },
  "freshness": { "captured_at":"...", "last_update":"...", "stale": false }
}
```

- **去 vig server-side 算**（`lib/devig.ts`，比例正規化；h2h 三邊、totals 同 point 兩邊。**`novig` 不進 client `value.ts`**——Issue 4）。
- **賠率讀取 query hint（Issue 1）**：取「該場最新一筆」直接掃 `odds_snapshots` 限定 `match_id`（吃 `odds_snapshots_lookup` index），**不要**對全表跑 `odds_closing` view（賽前 = 全量、慢）：
  ```sql
  SELECT DISTINCT ON (bookmaker, market, outcome, coalesce(point, -1))
         bookmaker, market, outcome, point, decimal_odds, captured_at, last_update
  FROM odds_snapshots
  WHERE match_id = $1
  ORDER BY bookmaker, market, outcome, coalesce(point, -1), captured_at DESC
  ```
  > PostgREST 無 `DISTINCT ON` → 用 RPC（Postgres function）或在 route handler 取 `match_id` 全量後 in-memory reduce（單場資料量小）。`odds_closing` view 僅用於 P3 校正（已結算 + kickoff 前），**非** P5 即時讀取路徑。
- totals 模型圖層讀 `model_total_lines`（P3 §4.4 已在實際線預算），**非** `p_over_2_5`。
- **ToS 防護**：只回**去 vig 機率 + best/清單**（聚合值），**不傾印 `odds_snapshots` 全量** → 降低 The Odds API 重散布風險（§0 不在 P5）。
- 沒上盤 → `pinnacle_novig: null` + `market_available: false`（前端走「只有模型、不出 value」路徑，§6.1）。

### 4.4 freshness / stale 判定

`stale = (now − captured_at) > FRESH_WINDOW`（如 24h，可調）。UI 顯示「資料時間：…」並在 stale 時標警示（P3 §9 5c）。

---

## 5. `/value` EV 計算機（前端算術；port `engine/value.py`）

> 落實 P3 §5.5（整體留 P5 的前端）：頁面結構、賠率輸入、結果顯示、格式選擇器、responsible footer。

### 5.1 `lib/value.ts`（port，**model-free**）

逐函數對應 `engine/value.py`（**同一參考實作**）：

| `value.py` | `value.ts` | 規格 |
|---|---|---|
| `to_decimal(v, fmt)` | `toDecimal` | P3 §5.6（decimal/HK/American/Indonesian/Malaysian；`d>1` 否則 throw） |
| `ev(p, d)` | `ev` | `p·d−1`（P3 §5.0） |
| `is_value(p, d)` | `isValue` | `ev>0` |
| `kelly_fraction(p, d, f)` | `kellyFraction` | `max(0, f·(d·p−1)/(d−1))`，預設 ¼（P3 §5.3） |
| `is_quarter_line(pt)` | `isQuarterLine` | `2·pt` 非整數 |
| `totals_line_matches` | `totalsLineMatches` | `user_point == pinnacle_main_point` |
| `best_available` | `bestAvailable` | 同線內取最大 decimal（TV7） |
| `evaluate(...)` | `evaluate` | 組裝；totals 線不一致 → `line_mismatch`、無 EV；quarter → `approximate` |

- **`p_novig` 一律由 server API（§4.3）提供**，client 不重算去 vig。**`novig` 去 vig 函數放 server-only `lib/devig.ts`，不 port 進 client `value.ts`**（Issue 4）——value 路徑**只吃 server 給的 `pinnacle_novig`**。
- **`lib/value.ts` 不得 import 任何模型機率，也不含 `novig`**（守 TV4 / D5）。模型實驗圖層（§4.3 `model_layer`）只進「實驗性顯示」區，**不進 `evaluate`**。

### 5.2 頁面流程

```
1. 選比賽（dropdown，來自 /api/matches）
2. 選 market（1X2 / 大小分）
   - totals → 自動帶入 Pinnacle 主線 point（如 2.25）；使用者可改自己的 point
     → 若 ≠ 主線 → line_mismatch（不出 EV/value，§5.2）（Issue 11）
3. 選 outcome（主/和/客 或 over/under）+ 賠率格式（§5.6 selector）+ 輸入自己 app 的賠率
4. client: d = toDecimal(input, fmt)         // d≤1 → 即時錯誤提示（TU7）
   server 已給: pinnacle_novig, main_point, is_quarter_line
5. 顯示:
   - EV = p·d−1、value ⇔ EV>0
   - ¼ Kelly = bankroll 的 X%（可選輸入 bankroll → 換算金額）
   - totals 線 ≠ Pinnacle 主線 → 標 line_mismatch，不出 EV/value（P3 §5.2 / TV2）
   - quarter line → EV/Kelly 標「近似」（P3 §5.2/§5.3 / TV8）
   - line-shopping：同一條線內各書 best（TV7）
   - 模型實驗圖層（§4.3 model_layer）：標「實驗性」，與上方 value 視覺隔開
6. Responsible-gambling footer（雙語，§7）
```

---

## 6. 關鍵 UI 規則（硬性）

### 6.1 模型 ⇄ 市場並列（D5 / trap #7）— 最重要

- 任何顯示模型 1X2 / 大小分之處：**同一視圖內並列市場去 vig 機率**（有盤時）。
- 模型側永遠帶「**實驗性 / experimental**」標籤 + tooltip（連到市場效率聲明）。
- **無市場資料時**：只秀模型，但（a）更顯眼的實驗性標籤、（b）明示「無市場可比較」、（c）**絕不出 value/EV**。
- **絕不**把模型機率排版成唯一/最終「答案」（無置中大字、無「預測：X 勝」斷言式標題）。

### 6.2 provenance / 新鮮度常駐（TU10）

每個資料區塊顯示來源時戳：F1/F3 → `model_version` + Elo `elo_asof`；F4 → `sim_n` + `computed_at`；市場 → `captured_at`（+ stale 警示）。

### 6.3 爆冷 badge（F1，UI 層規則，閾值可調）

P1 §5.4 規則，**放 `lib/upset.ts`（前端/或 server `/api/matches`），不進引擎**：

```
weaker = elo 較低那隊
if abs(elo_home − elo_away) >= UPSET_ELO_GAP (預設 150)
   and (p_weaker_win + p_draw) >= UPSET_PROB (預設 0.40):
       flag '爆冷風險 / Upset risk'
```

閾值為**可調常數**（非 hardcode 深處）；TU13 驗規則。

### 6.4 淘汰賽 TBD（trap #10 / TU4）

淘汰賽 32 場賽前無隊伍（DB 未存）→ `/matches` 顯示「淘汰賽待抽籤 / Knockout TBD」佔位，**不 crash、不臆造對戰**。抽籤 + ingest 後自然出現。

### 6.5 全站 footer（D7 / TU9 / TU12）

- **Elo attribution（CC BY-SA 4.0）**：「Elo 資料源自 eloratings.net，依 CC BY-SA 4.0 釋出」+ 連結。
- **市場效率聲明**：「模型為實驗性；收盤市場賠率通常最準。模型與市場並列僅供對照，非投注建議。」
- **負責任博弈聲明**（`/value` 強制；雙語）：娛樂用途、量力而為、求助管道。

### 6.6 異常 / 空資料 graceful（Issue 5）

⚠️ **空資料不是 bug、不可 throw**——以下情境必須 graceful 顯示（Claude Code 易把空當錯誤）：

| 情境 | UI 行為 |
|---|---|
| `/api/*` 回 5xx / Supabase 連不上 | 錯誤卡片 + 重試鈕，不白屏（error boundary） |
| `match_predictions` 空（predict 未跑） | `/matches` 顯示「預測資料準備中」 |
| `group_sim` 空（simulate 未跑） | `/groups` 顯示「模擬數據準備中」，不 crash |
| 某場 `market: null`（沒上盤） | 只秀模型 + 強化實驗標籤 + 不出 value（= §6.1 / TU3） |
| `name_zh` 全 null | 全站 fallback `name_en` + banner「中文隊名準備中」（不靜默） |
| 淘汰賽未抽籤 | 「待抽籤」佔位（= §6.4 / TU4） |

> 區分：**資料缺**（上述，graceful）vs **契約違反**（如 `/api/matches` 回的場次無 `home/away`、機率不加總）→ 仍 fail-loud（log + 錯誤卡片），不靜默近似。

---

## 7. 驗收測試（PASS / FAIL，沿用 smoke-test 文化）

> 自動化分層：**(A) 純算術/邏輯**（`lib/value.ts`、`lib/upset.ts`、i18n key 對齊）→ vitest 離線可測。**(B) 建置/安全**（service key 不進 bundle）→ build-time 檢查。**(C) 呈現規則**（並列、footer、graceful）→ component test（Testing Library）+ 人工 checklist。

| ID | 測試 | 通過條件 | 層 |
|---|---|---|---|
| **TU1** | i18n 覆蓋 | `zh-TW`/`en` 字典 key 一一對應、無缺；無 hardcode 顯示字串；切換 locale 全站生效；隊名走 `name_zh`/`name_en`（非機翻）；`name_zh=null` → fallback `name_en` 不 crash | A/C |
| **TU2** | 模型⇄市場並列 | 凡顯示模型 1X2/大小分處，有盤時並列市場去 vig；模型帶「實驗性」標籤；無「唯一答案」排版 | C（**部分自動化**） |
| **TU3** | 無盤 graceful | 無市場的場次只秀模型 + 強化實驗標籤 + 不出 value/EV，且不報錯 | C（**自動化**） |
| **TU4** | 淘汰賽 TBD | 淘汰賽未抽籤 → 顯示「待抽籤」佔位、不 crash、不臆造對戰 | C（**自動化**） |
| **TU5** | value.ts ⇄ value.py 一致 | `toDecimal/ev/kellyFraction/isQuarterLine/totalsLineMatches/evaluate` 對 P3 TV1/TV3/TV6/TV8 黃金向量輸出與 `engine/value.py` 完全一致。**黃金向量由 `engine/value.py` 生成存 `web/tests/fixtures/golden_vectors.json`**，vitest 對該 JSON 比（Issue 10） | A |
| **TU6** | value 隔離 | value 路徑只吃 server `pinnacle_novig`；`lib/value.ts` 不 import 任何模型機率（靜態檢查 + 程式碼掃描）；`model_layer` 不進 `evaluate` | A/B |
| **TU7** | 賠率格式轉換 | HK/American/Indonesian/Malaysian → decimal 與 P3 §5.6 範例一致；`d≤1` → UI 即時錯誤 | A |
| **TU8** | line-mismatch / quarter | 使用者 totals 線 ≠ Pinnacle 主線 → 標 `line_mismatch`、不出 EV/value；quarter line → EV/Kelly 標「近似」 | A/C |
| **TU9** | attribution / 市場聲明 | 每頁（雙語）含 Elo CC BY-SA 4.0 attribution + 市場效率聲明 | C（**自動化**） |
| **TU10** | provenance / 新鮮度 | 頁面顯示 `elo_asof` / `model_version` / `sim_n` / 市場 `captured_at`（stale 標警示） | C |
| **TU11** | service key 安全 | `SUPABASE_SERVICE_KEY` 不出現在 client bundle（無 `NEXT_PUBLIC_`）；只 server 路徑使用（建置產物掃描） | B |
| **TU12** | 負責任博弈 footer | `/value`（雙語）含負責任博弈聲明 | C（**自動化**） |
| **TU13** | 爆冷規則 | `|Δelo|≥150` 且弱隊 `(p_win+p_draw)≥0.40` → 出 badge；閾值為可調常數 | A |
| **TU14** | 群組機率呈現 | `/groups` 每組 4 隊；`p_first` 組內加總 ≈ 1（容差 ±1/sim_n）；按 `p_advance` 排序橫條正確 | A/C |

> 市場相關呈現測試需已 ingest 賠率（無則走 TU3 graceful 路徑）。純算術（TU5/TU7/TU8/TU13）離線可測。

### 7.1 component-test 自動化範圍（TU2 / TU3）

`@testing-library/react` + jsdom（vitest，離線）已自動化以下**行為**斷言（斷言走 **dictionary 值 + 文字/角色**，**不碰 Tailwind class**，避免改樣式就全紅）：

| 測試檔 | 涵蓋 |
|---|---|
| `tests/ModelVsMarket.test.tsx` | **TU2（部分）**：有盤 → 模型與市場機率**並列**渲染 + 「實驗性」標籤存在；**TU3（matches 側）**：無盤 → 只渲染模型 + 明示 no-market note + 不渲染市場 bar + 不 throw |
| `tests/ValueCalculator.test.tsx` | **TU3（value 側）**：`market_available=false` → 出 no-market 訊息、**不出 value/EV 判定**、responsible footer 仍在（**TU12**） |
| `tests/KnockoutTbd.test.tsx` | **TU4**：data-independent 佔位（無 props）渲染「待抽籤」heading + desc，雙語、不 crash、不臆造對戰 |
| `tests/Footers.test.tsx` | **TU9**：市場效率聲明 + Elo CC BY-SA 4.0 license / eloratings.net 連結（by role + href）；**TU12**：負責任博弈 title + body；皆驗 en + zh-TW 雙語 |

> ⚠️ **TU2 的「無唯一答案排版」是視覺/設計判斷，刻意留人工**——Testing Library 無法測排版意圖，硬寫 class 斷言會脆裂。人工 checklist：模型無置中大字、無「預測：X 勝」斷言式標題、模型側永遠有市場並列（或無盤時強化標籤）。

---

## 8. 設計風險清單

1. **模型被誤當「答案」**（最高風險）→ D5 / §6.1：強制並列市場 + 實驗性標籤 + 無斷言式排版（TU2/TU3）。
2. **service key 外洩** → D3 / §2.1：server-only env、無 `NEXT_PUBLIC_`、build 掃描（TU11）。
3. **value 路徑混入模型機率** → D4 / §5.1：`value.ts` model-free、`p_novig` 只來自 server、`model_layer` 隔離（TU6）。
4. **隊名機器翻譯出錯** → D2 / §3.2：策展 `name_zh`，null fallback 標記，不機翻（TU1）。
5. **淘汰賽 TBD / 無盤場次** → §6.1/§6.4：graceful 佔位，不 crash、不臆造（TU3/TU4）。
6. **賠率重散布 ToS** → §4.3：只回聚合去 vig + best，不傾印 `odds_snapshots` 全量。
7. **資料新鮮度誤導** → §4.4/§6.2：常駐 captured_at + stale 警示（賠率手動 ingest，可能舊）。
8. **i18n 字典漂移** → §3.1：key 對齊 lint，缺 key fail-loud（TU1）。
9. **quarter-line / line-mismatch 沒標** → §5.2：近似 / line_mismatch 旗標（TU8）。
10. **CC BY-SA 授權** → D7 / §6.5：全站 attribution footer（TU9）。

---

## 9. 結構（新增 / 修改）

```
web/                                  [NEW] Next.js (App Router) 前端
  app/[locale]/
    layout.tsx                        — locale 包裝 + 全域 footer（attribution / 市場聲明）
    page.tsx                          — 首頁/總覽（含 disclaimer banner）
    matches/page.tsx                  — F1/F3：1X2 + 大小分 + 爆冷 + 市場並列
    matches/[matchId]/page.tsx        — 單場詳情（可選）
    groups/page.tsx                   — F4：12 組晉級機率橫條 + 排序
    value/page.tsx                    — F5：EV 計算機（client island）
  app/api/
    matches/route.ts                  — server read + upset flag（service key）
    groups/route.ts                   — server read group_sim + 隊名
    value/market/route.ts             — pinnacle 去 vig + line-shopping + model_layer + freshness
  middleware.ts                       — next-intl locale routing（/ → /zh-TW；Accept-Language 協商）（Issue 9）
  lib/
    supabaseServer.ts                 — server-only client（service key；嚴禁 client import）
    devig.ts                          — server-only 比例正規化 novig（不進 client value.ts）（Issue 4）
    value.ts                          — port engine/value.py（純函數、model-free、無 novig）
    upset.ts                          — 爆冷規則（server-only utility，閾值可調）（Issue 3）
    teamName.ts                       — name_zh/name_en 解析 + fallback
    i18n.ts                           — next-intl 設定
  messages/{zh-TW,en}.json            — UI 字串字典（key 一一對應）
  components/
    ProbBar.tsx                       — Tailwind 橫條（無 chart lib）
    ModelVsMarket.tsx                 — 模型⇄市場並列 + 實驗性標籤（D5 核心）
    UpsetBadge.tsx / FreshnessIndicator.tsx / OddsFormatSelector.tsx
    AttributionFooter.tsx / Disclaimer.tsx / ResponsibleGamblingFooter.tsx
    ErrorCard.tsx / EmptyState.tsx     — §6.6 graceful（錯誤/空資料）
  app/[locale]/error.tsx / not-found.tsx — error boundary（§6.6）
  tests/
    value.test.ts                     — TU5/TU7/TU8 黃金向量（vs value.py）
    upset.test.ts                     — TU13
    i18n.test.ts                      — TU1 key 對齊
    fixtures/golden_vectors.json      — 由 engine/value.py 生成（TU5；Issue 10）
  tailwind.config.ts / next.config.ts / package.json / tsconfig.json / vitest.config.ts
docs/P5-spec.md                       [NEW] 本文件
CLAUDE.md                             [MODIFY] 更新現況（加 P5）、結構、指令（cd web && npm run dev / build）
etl/sql/schema.sql                    [UNCHANGED] v1 不需新 RLS（§2.2）
```

---

## 10. 之後（不在 P5）

- **P4** 球員 anytime-goalscorer props（Feature 2，市場賠率）→ 屆時 `/matches` 詳情頁加 props 區塊。
- 淘汰賽 bracket / 奪冠機率（P2 extension）+ outright（`..._winner`）→ `/groups` 之後加 bracket 視圖。
- 個人 CLV 報表（需下注 log）、live 比分串流、anon 直連 + RLS policy（若改前端直查）。
- a11y / SEO / OG image 收尾、深色模式。

---
P5 spec 定案 2026-06-09（stack=Next.js+Tailwind、雙語 zh-TW/en、server service-key 存取——三項已由 user 裁決）。
review（[p5_spec_review.md](p5_spec_review.md)）12 issues + Q1 tip 已併入：ISR time-based 1800s（§2）、odds query hint（§4.3）、upset/devig server-only（§4.1/§5.1）、空資料 graceful（§6.6）、middleware/golden_vectors（§9）等。**通過，開始實作。**
