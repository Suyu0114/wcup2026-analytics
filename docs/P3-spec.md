# World Cup 2026 Analytics — P3 Spec

> 給 Claude Code 的實作規格 / 「執行契約」。§9 的 7 個 flag + review 抓到的 5 個洞**已裁決並併入各節**；§9 改為**裁決紀錄**（供協作者看決策軌跡）。
> 風格遵循專案原則：**verify-don't-assume**、**data integrity over approximation**、**spec 與 code 不符要立即標記**、**fail-loud**、**idempotent**、**provenance**。對齊 [P0-P1-spec.md](P0-P1-spec.md) §3/§4/§5 與 [CLAUDE.md](../CLAUDE.md)。

---

## 0. Scope

**P3 = Feature 5（EV / value 計算機）+ 賠率 ingest + 校正學習線。**

核心交付：使用者輸入自己 app 的賠率 → 比 sharp 市場線（Pinnacle 去 vig）→ 算 **EV / value 判定 / ¼ Kelly 注額（佔 bankroll %）**。

依賴：P0（`teams` / `matches` / `team_aliases`）、P1（`match_predictions.lambda_home/away`）。

**明確不在 P3：**
- P2 Monte Carlo（Feature 4）、P4 球員 props（Feature 2）、P5 UI polish。
- Shin's method 去 vig（v1 比例正規化）、totals 跨線插值（線不一致只標 mismatch）。
- 個人 CLV（v1 無下注 log；只存 closing 供日後算）、**totals 校正**（v1 校正只做 1X2，見 §6）。
- **EV 計算機前端（§5.5 整體推遲至 P5）**：`engine/value.py` 純函數是 P3 交付物；頁面結構、賠率輸入 UI、結果顯示一律留 P5。

**在 P3（review 後新增）：** 賠率格式轉換（使用者可能貼香港/馬來/印尼/美式盤 → 一律轉 decimal，見 §5.6）。

---

## 1. Decisions locked

1. **EV 比市場、不比模型**：`EV = p_pinnacle_novig(outcome) × 使用者賠率 − 1`，`>0` 才 value。
2. **模型機率與 value 判定完全隔離**，UI 標實驗性（守 P0-P1 §7）。
3. **賠率走 ETL 進 Supabase，非純前端**（key 機密 / 配額 / 歷史快照）。只有「使用者輸入賠率 → 算 EV」算術在前端。
4. **The Odds API**（user 已實測驗證）；Pinnacle 當**唯一** sharp 去 vig 基準；其餘書只做 line-shopping 顯示。
5. **去 vig = 比例正規化**。
6. **Kelly v1 要做**：fractional，預設 ¼，負 EV → 0，配 responsible 提示。
7. **校正（T10）不 gate**；獨立學習線、人工 review、`n≥30–40` 再談參考門檻。

---

## 2. 資料來源（The Odds API）

| 項目 | 內容 |
|---|---|
| Base | `https://api.the-odds-api.com/v4` |
| 機密 | `ODDS_API_KEY`（env，已在 `.env`；**勿進 git / 勿進前端**） |
| sport key | `soccer_fifa_world_cup`（逐場）。⚠️ `..._winner`=outright，P2 才用 |
| **一次 call** | `GET /sports/soccer_fifa_world_cup/odds?apiKey=…&bookmakers=<≤10 家>&markets=h2h,totals&oddsFormat=decimal` |
| 成本 | **2 credits/call**。用 `bookmakers=` 參數時，**≤10 家書（任何 region）算 1 region-equiv**，且 `bookmakers=` 優先於 `regions=` → **不傳 `regions=`**（傳了被忽略、徒增誤導）。免費 500/月 |
| 書單 | `pinnacle`（sharp 基準，eu）+ **混 eu/us 熱門書 ≤10 家**（親友用美系 app → 應納幾家 us 書，如 draftkings/fanduel/betmgm；成本不變）。確切清單 impl 時定，**總數含 pinnacle ≤10** |
| 涵蓋 | 目前只有小組賽 72 場有盤；淘汰賽抽籤、盤上架後才有 → 沒盤的場次 **graceful**（只秀模型/實驗性，不做 value） |

**Pinnacle 主線（totals）定義**：Pinnacle 在 `totals` market 回傳的 `point`（請求 `totals` 不含 alternate，通常**唯一**）。若回多條 → 取兩邊 implied 最接近的那條（`min |1/p_over − 1/p_under|`）。

### 2.1 enum / key → 內部值

| The Odds API `markets` | 內部 `market` |
|---|---|
| `h2h` | `h2h`（1X2） |
| `totals` | `totals`（含 `point`） |

| market | outcome `name` | 內部 `outcome` | `point` |
|---|---|---|---|
| h2h | == 主隊名 | `home` | null |
| h2h | == 客隊名 | `away` | null |
| h2h | `Draw` | `draw` | null |
| totals | `Over` | `over` | 有 |
| totals | `Under` | `under` | 有 |

> **定向**：outcome 的 home/away 對齊**我方** `matches.home_team/away_team`，與 odds API 的主客不一致就交換（§4.1）。

### 2.2 ⚠️ 陷阱（user 實測）

- **totals 浮動 + 常 quarter line**：實測 Pinnacle `Mexico–South Africa`（`537327`）`point=2.25`。
  → 存實際線 + 雙邊 price（§3）；line-matching（§5.2）；模型在實際線重算（§5.4）；**quarter line（`2×point` 非整數，如 2.25/2.75）的 EV/Kelly 是近似值（半 push 結算）→ 顯示層必須標「近似」**（§5.2/§5.3）。
- **h2h 無線**：直接去 vig 三邊。

### 2.3 Identity（賠率隊名 → team_id）

沿用 P0 fail-loud alias（[P0-P1-spec.md](P0-P1-spec.md) §2.3）：賠率隊名經 `team_aliases` → `team_id`，`source='odds_api'`；對不上 raise。先 alias seeding（§4.0）再 ingest。

---

## 3. Schema DDL

```sql
-- 3.1 賠率快照：append-only；「賠率真的變動才存一列」由 code 以「價格 vs 最新」判定，避免高頻 poll 灌爆
create table odds_snapshots (
  snapshot_id   bigserial primary key,
  match_id      text not null references matches(match_id),
  bookmaker     text not null,                 -- 'pinnacle' | 'draftkings' | ...
  market        text not null,                 -- 'h2h' | 'totals'
  outcome       text not null,                 -- 'home'|'draw'|'away'|'over'|'under'（我方定向）
  point         numeric,                        -- totals 才有（如 2.25）；h2h null
  decimal_odds  numeric not null check (decimal_odds > 1.0),
  last_update   timestamptz not null,           -- The Odds API last_update（provenance；⚠️ 同價格也會更新）
  captured_at   timestamptz not null            -- 我方 poll 批次時戳（provenance）
);

-- backstop index；真正的 store-on-change 由 code 以「價格 vs 最新」判定（見 §4.1 / §9 B'）。
create unique index odds_snapshots_change_uniq
  on odds_snapshots (match_id, bookmaker, market, outcome, coalesce(point, -1), last_update);

create index odds_snapshots_lookup on odds_snapshots (match_id, market, bookmaker, outcome);

-- 3.2 收盤線：用 view 定義，不存旗標（單一真相來源）。
--     = 每個 (match,bookmaker,market,outcome[,point]) 在 kickoff 前 captured_at 最新的那筆。
--     配 §3.1「變動才存」，開賽前最後一次變動那列天然即收盤線。
create view odds_closing as
select distinct on (match_id, bookmaker, market, outcome, coalesce(point, -1))
       s.match_id, s.bookmaker, s.market, s.outcome, s.point,
       s.decimal_odds, s.last_update, s.captured_at
from odds_snapshots s
join matches m using (match_id)
where s.captured_at <= m.kickoff_utc
order by s.match_id, s.bookmaker, s.market, s.outcome, coalesce(s.point, -1), s.captured_at desc;

-- 3.3 模型在「Pinnacle 實際 totals 線」的機率（衍生；給 totals 的「模型 vs 市場」實驗圖層）
--     由 match_predictions.lambda_home/away 在實際線重算，非沿用固定 p_over_2_5。填寫時機見 §4.4。
create table model_total_lines (
  match_id      text not null references matches(match_id),
  point         numeric not null,              -- = Pinnacle 該場當前主線
  model_version text not null,                 -- = 'dc-v1.0'
  model_p_over  numeric not null,
  model_p_under numeric not null,
  computed_at   timestamptz not null default now(),
  primary key (match_id, point, model_version)
);
```

> 去 vig 機率不落表，讀取層 / view 即算（§5.1）。

---

## 4. ETL 契約（P3）

通則 fail-loud、provenance。⚠️ `odds_snapshots` **append-only + 變動才存**（非 upsert 覆蓋）：`insert_odds_snapshots_dedup` 比對「**incoming 價格 vs 該 (match,book,market,outcome,point) 最新已存價格**」，不同才 insert（分頁取全量避開 1000 列上限）。**不可用 `last_update` 當去重鍵**（會空轉，見 §9 B'）。

### 4.0 odds_api alias seeding（**先於 odds ingest**）

```
names = OddsSource.event_team_names()            # events 端點（不耗 markets credit）
for name in names:
    tid = resolve_alias(name) or match_by_normalized_name(name, teams.name_en)
    if tid: upsert team_aliases(alias=name, tid, source='odds_api')
unmatched -> 人工補（同 P0 流程）
assert 賠率隊名全對到 team_id                      # 否則 raise
```

### 4.1 Odds ingest（OddsSource → odds_snapshots）

```
batch_ts = now()
data = OddsSource.get_odds(books=BOOKMAKERS, markets=['h2h','totals'])   # 1 call / 2 credits
rows = []
for ev in data:
    a_id = resolve_alias(ev.home_team); b_id = resolve_alias(ev.away_team)   # 對不上 -> raise
    # event -> match_id：小組賽「無序隊伍對」本身唯一 → 以 pair 為主鍵
    m = find_match_by_pair({a_id, b_id})
    if m is None: skip(ev)                       # 還沒抽籤/還沒上盤的淘汰賽 -> graceful
    # 時間只當 soft 確認：pair 對上、kickoff 微移 -> warn（別 hard-fail）
    if abs(ev.commence_time - m.kickoff_utc) > SOFT_WINDOW: warn(ev, m)
    # ⚠️ 淘汰賽日後同隊可能再遇 -> 屆時 pair 不再唯一，需用 commence_time/round 硬判（見 §9 A）
    orient = identity if a_id == m.home_team else swapped   # 對齊我方主客
    for bk in ev.bookmakers:
        for mk in bk.markets:                    # h2h / totals
            lu = mk.last_update                  # provenance（⚠️ 非去重鍵；會空轉）
            for oc in mk.outcomes:
                outcome, point = map_outcome(mk.key, oc, orient)        # §2.1
                rows.append(odds_snapshots(match_id=m.match_id, bookmaker=bk.key,
                    market=mk.key, outcome=outcome, point=point,
                    decimal_odds=oc.price, last_update=lu, captured_at=batch_ts))
insert_odds_snapshots_dedup(rows)  # 比對 incoming 價格 vs 最新已存價格，不同才 insert
```

### 4.2 Closing（CLV 預備，v1 只存不算）

```
# 開賽前一段時間（如 T-2h ~ T-30m）多跑一兩次 ingest（同 4.1），抓晚盤異動。
# closing 不存旗標 -> 由 odds_closing view 取（kickoff 前 captured_at 最新一筆）。
# 發方式：GitHub Actions → odds-ingest workflow → Run workflow（手動）。
# ⚠️ 不可依賴 GitHub Actions schedule cron 的精準度（高負載時可能延遲 30min+）；closing 快照必須人工確認觸發時間。


```
> 配「變動才存」，最後一次變動列即收盤線。v1 不做個人 CLV（無下注 log）。
> 日後若需全自動 closing，升級方案：cron-job.org webhook → GitHub `workflow_dispatch` API（Method B，待 P3 後評估）。


### 4.3 quota 預算（< 500 credits/月）

```
每 call 2 credits（bookmakers= ≤10 家、markets=h2h,totals、不傳 regions）。
月上限 500 → ≤250 calls/月。

排程機制（見 §4.5 GitHub Actions workflow）：
  平時（非賽期）：daily cron 每日 1 call → ~30 calls/月
  賽期（6/11–7/19）：daily cron + 比賽日每場前 1–2 次 workflow_dispatch 手動觸發
  估算（39 天賽期）：
    daily cron:           39 calls
    pre-kickoff closing:  104 場 × 1.5 次 = ~156 calls（手動觸發，可略過非關心場次）
    buffer:               ~20 calls
    合計:                 ~215 calls → < 250 ✅

固定 cadence 估算寫進 TO9 guard。
```

### 4.4 model_total_lines 重算（每次 odds ingest 後）

```
for m in 有 Pinnacle totals 的 matches:
    L = pinnacle_main_point(m)                    # §2「主線」定義
    if model_total_lines[(m, L)] 不存在:           # 線移動 -> 出現新 L -> 需新算
        lh, la = match_predictions[m].lambda_home, lambda_away
        P = score_matrix(lh, la)                  # 重用 engine.dixon_coles（Python）
        upsert model_total_lines(m, point=L, model_version,
            model_p_over=P(total>L), model_p_under=P(total<L))
```
> 線移動只會新增 `(match, 新 L)` 列；舊線列保留（歷史）。前端讀「當前主線」那列。

### 4.5 GitHub Actions Workflow（odds-ingest）

檔案：`.github/workflows/odds-ingest.yml`

```yaml
name: Odds Ingest

on:
  schedule:
    - cron: '0 6 * * *'   # UTC 06:00 每日例行（非精準 closing，容忍 jitter）
  workflow_dispatch:        # 手動觸發（比賽前 closing 快照用）
    inputs:
      dry_run:
        description: 'Dry run (skip Supabase write)'
        required: false
        default: 'false'
        type: boolean

jobs:
  ingest:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: '3.12'
      - run: pip install -r requirements.txt
      - name: Run odds ingest
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_KEY: ${{ secrets.SUPABASE_SERVICE_KEY }}
          ODDS_API_KEY: ${{ secrets.ODDS_API_KEY }}
        run: |
          if [ "${{ inputs.dry_run }}" == "true" ]; then
            python -m etl.ingest_odds --dry-run
          else
            python -m etl.ingest_odds
          fi
```

> **Secrets 需手動在 GitHub repo Settings → Secrets 設定**：`SUPABASE_URL`、`SUPABASE_SERVICE_KEY`、`ODDS_API_KEY`。  
> **升級路徑（Method B）**：如需精準 closing 全自動化，改用 cron-job.org 每場比賽前定時打 GitHub `workflow_dispatch` REST API。

---

## 5. EV / value 計算機（讀取層 + 前端）

### 5.0 核心（前端算術；市場線從 Supabase 讀；輸入一律 decimal，§5.6）

```
d_user = to_decimal(user_input, user_format)               # §5.6 轉換 + 驗證 d>1
p = pinnacle_novig(match_id, market, outcome[, point])     # §5.1
ev = p * d_user - 1
value = ev > 0
```

### 5.1 去 vig（比例正規化）

```
def novig(prices: dict[outcome -> decimal]) -> dict[outcome -> prob]:
    raw = {o: 1.0/prices[o] for o in prices}
    s = sum(raw.values())                                   # overround > 1
    return {o: raw[o]/s for o in raw}                       # Σ = 1
# h2h: {home,draw,away}（三邊）；totals@L: {over,under}（兩邊，同一 point）
```

### 5.2 totals line-matching（線不一致不算 value）

```
L_pin = pinnacle_main_point(match_id)
if user_market == 'totals' and user_point != L_pin:
    flag 'line_mismatch'                                    # 標清楚
    show 1/pinnacle_novig@L_pin 當參考                       # 不算 EV/value（不跨線插值）
else:
    p = novig(pinnacle @ L_pin)[user_outcome]; ev = p*d_user - 1
if is_quarter_line(point):                                  # 2×point 非整數
    label EV/Kelly = 'approximate'                          # 半 push 結算（§2.2）
```

### 5.3 Kelly（fractional，預設 ¼，輸出佔 bankroll %）

```
KELLY_FRACTION = 0.25
f_star = (d_user * p - 1) / (d_user - 1)        # p = pinnacle_novig
bankroll_fraction = max(0.0, KELLY_FRACTION * f_star)       # 負 EV -> 0
# 顯示「建議 = bankroll 的 X%」；可選讓使用者輸入 bankroll 換算金額。
# quarter line -> 與 §5.2 一致標「近似」。
```

### 5.4 模型圖層（totals，實驗性、與 value 隔離）

```
# 讀 model_total_lines（§4.4 已在 Pinnacle 實際線預算好），不用固定 p_over_2_5。
# UI 標「實驗性」，絕不進 §5.0 value 路徑。
```

### 5.5 前端結構（⚠️ 整體留 P5，P3 不實作）

P3 交付物為 `engine/value.py` 純函數（已測試，TV1–TV8）。  
EV 計算機頁面、賠率輸入 UI、結果顯示、賠率格式選擇器、responsible footer 一律留 P5 實作。

> P5 實作時參照 §5.0–5.4/§5.6 的邏輯規格；`engine/value.py` 即前端的算術參考實作。

### 5.6 賠率格式轉換（→ decimal）

> 台灣/美系 app 常非 decimal。使用者選格式，輸入值 `v`，一律轉 decimal `d`（`d>1` 否則報錯）。

| 格式 | → decimal `d` | 範例 |
|---|---|---|
| Decimal | `d = v` | 2.50 → 2.50 |
| Hong Kong | `d = v + 1` | 1.50→2.50；0.50→1.50 |
| American | `v>0: d=1+v/100`；`v<0: d=1+100/|v|` | +150→2.50；−200→1.50 |
| Indonesian | `v>0: d=v+1`；`v<0: d=1+1/|v|`（`|v|≥1`） | +1.50→2.50；−2.00→1.50 |
| Malaysian | `v>0: d=v+1`；`v<0: d=1+1/|v|`（`|v|≤1`） | +0.50→1.50；−0.667→2.50 |

---

## 6. 校正學習線（T10，**非 gate，僅 1X2**）

```
# 已結算比賽（matches.status='final' + 比分）上：
model_p  = match_predictions(1X2)                 # 標實驗性
market_p = pinnacle_novig(odds_closing, h2h)
report Brier / log-loss(model_p vs 實際) 與 (market_p vs 實際)，同一批
```
> 不 auto-gate；人工 review；`n<30–40` 不下結論；達量後可考慮「模型 ≤ Pinnacle×1.1」當**參考**（非硬擋）。模型永遠標實驗性。**totals 校正 v1 不做。**

---

## 7. 驗收測試（PASS / FAIL，沿用 T/TF 風格）

| ID | 測試 | 通過條件 |
|---|---|---|
| **TO1** | ingest 涵蓋 | 72 場小組賽都有 **Pinnacle h2h**（三邊）；**totals 有開才收**，沒開標 graceful、不計缺；**首跑印 totals 覆蓋率** |
| **TO2** | identity | 每筆 event 對到**恰一** `match_id`（小組賽 pair 唯一；時間 soft-warn）；賠率隊名 unmapped=0 否則 raise |
| **TO3** | totals 形狀 | 每筆 Pinnacle totals 有 `point` + Over & Under 兩邊 price |
| **TO4** | de-vig h2h | 三邊去 vig `abs(Σp−1)<1e-6` |
| **TO5** | de-vig totals | 同場同 `point` 兩邊去 vig `abs(Σp−1)<1e-6` |
| **TO6** | 變動才存 | 同價格重複 poll → **不增列**（價格 vs 最新比對；`last_update` 變了也不增列） |
| **TO7** | closing view | `odds_closing` 對每場每 outcome 取到 kickoff 前最新一筆 |
| **TO8** | model 線 | `model_total_lines` 每場有「當前 Pinnacle 主線」對應列；由 `lambda_*` 重算（非 `p_over_2_5`）；線移動會新增列 |
| **TO9** | quota guard | 固定 cadence 估算 ≤500 credits/月（≤250 calls；不傳 regions） |
| **TV1** | EV 正確 | `EV=p·d−1` 與手算一致；`value ⇔ EV>0` |
| **TV2** | line-matching | 使用者線 ≠ Pinnacle 主線 → 標 `line_mismatch`、不輸出 EV/value |
| **TV3** | Kelly | `f*=(d·p−1)/(d−1)` 正確；負 EV → 0；預設 ¼；輸出為 bankroll % |
| **TV4** | 隔離 | value/EV 路徑只吃 `pinnacle_novig`，模型機率不參與（程式層斷開） |
| **TV5** | totals 模型圖層 | 模型 `P(over L)` 由 `lambda_*` 在實際線算（非 `p_over_2_5`） |
| **TV6** | 賠率轉換 | HK/American/Indonesian/Malaysian → decimal 與 §5.6 範例一致；`d≤1` 報錯 |
| **TV7** | best-available（totals） | 只在**同一條線**內比最佳 price；不跨線 |
| **TV8** | quarter-line 標示 | `2×point` 非整數時，EV/Kelly 顯示帶「近似」旗標 |
| **T10** | 校正學習線 | 算 model vs Pinnacle-novig 的 Brier/log-loss（同批已結算、僅 1X2）；**不 gate**；模型標實驗性 |

> 市場資料測試需 `ODDS_API_KEY` + 已 ingest；無 key 時 skip（沿用 TF5 模式）。純算術（TV1/TV3/TV6）離線可測。

---

## 8. 設計風險清單

1. value 用市場非模型；模型程式層隔離 + UI 實驗性標籤（守 P0-P1 §7）。
2. 賠率走 ETL（key/配額/快照）。
3. totals 浮動/quarter line：存實際線、line-matching、實際線重算、quarter 標近似。
4. `odds_snapshots` append-only + 變動才存（**價格 vs 最新**比對；`last_update` 會空轉、非去重鍵），防高頻 poll 灌表。
5. event→match_id：小組賽 pair 唯一（時間 soft）；淘汰賽再遇需時間/輪次硬判。
6. region/credits：用 `bookmakers=`，≤10 家任何 region 仍 2 credits（可混 us 書給親友）。
7. closing 用 view 不用旗標（單一真相來源）。
8. 校正非 gate、僅 1X2；totals 校正 v1 不做。
9. 賠率格式：強制 decimal + 內建轉換（親友非 decimal app）。

---

## 9. 裁決紀錄（§9 flags + review 抓到的洞，已併入上文）

**7 個原始 flag：**
- **A（event→match_id + 定向）** → 小組賽**無序隊伍對為主鍵**（本身唯一）；`commence_time` 只 soft 確認（微移 warn 不 hard-fail）；淘汰賽日後同隊再遇才用時間/輪次硬判。（§2.1 定向 / §4.1）
- **B（append-only）→ B'（impl 修正，2026-06-09）**：保留 append-only +「變動才存」，但**去重鍵改為價格、非 `last_update`**。實測 The Odds API 的 `last_update` 同價格也會空轉（同一 series 05:18→15:22 都是 1.41，last_update 卻變了）→ 拿它當去重鍵會每 poll 灌一列。改為 code 比對「incoming 價格 vs 該 series 最新已存價格」，不同才 insert（分頁取全量避 1000 列上限）。一列＝一次真實**價格**變動；`last_update`/`captured_at` 仍存 provenance。（§3.1 / §4.1）
- **C（totals 模型圖層 server-side）** → ingest 後 Python engine 在實際線預算 `model_total_lines`，前端只讀，不 port JS。（§3.3 / §4.4 / §5.4）
- **D（region/credits）— 我先前理解有誤，已修正**：用 `bookmakers=` 參數時 ≤10 家（**任何 region**）算 1 region-equiv，且 `bookmakers=` 優先於 `regions=` → **不傳 `regions=`**。line-shopping 書單可混 eu+us（親友美系 app 應納 us 書），**成本仍 2 credits**。totals 去 vig 基準仍只認 Pinnacle。（§2 / §4.3）
- **E（is_closing）** → **拿掉旗標**，closing 由 `odds_closing` view 定義（kickoff 前最新一筆）；配「變動才存」天然成立。（§3.2 / §4.2）
- **F（72 場 totals 未驗證）** → h2h 要 72 場齊；totals「有開才收」+ 首跑印覆蓋率。（TO1）
- **G（key / 未獨立打 API）** → `ODDS_API_KEY` 已在 `.env`；spec 階段不燒 credit，形狀靠 user 實測。

**review 抓到的 5 個洞：**
1. **賠率格式輸入** → §5.6：強制 decimal + 內建 HK/American/Indonesian/Malaysian 轉換（TV6）。
2. **totals best-available 誤導** → §5.5：totals best-available 只在同線內比（TV7）。
3. **quarter-line EV/Kelly 是近似** → §5.2/§5.3/§5.5：quarter line 顯示帶「近似」旗標（TV8）。
4. **model_total_lines 重算時機** → §4.4：每次 odds ingest 後，對當前 Pinnacle 主線確保有列、線移動就重算（TO8）。
5. **零碎** → (a) Kelly 輸出佔 bankroll %（可選輸入 bankroll）§5.3/§5.5；(b) 校正僅 1X2、totals 不做 §6；(c) UI 秀 `last_update` 新鮮度 §5.5；(d) 「Pinnacle 主線」定義 §2。

---

## 10. 之後（不在 P3）

個人 CLV 報表（需下注 log）、Shin's de-vig、totals 跨線插值、totals 校正、校正參考門檻（達 n 後）、P2 outright（`..._winner`）。
**EV 計算機前端**（§5.5）：選比賽/outcome、賠率格式轉換輸入、EV/Kelly 顯示、line-shopping、模型實驗圖層、responsible footer（en + zh-TW）。


---
P3 spec 定案 2026-06-09（§9 七 flag + 五洞裁決已併入）。
