# World Cup 2026 Analytics — P6 Spec

> 給 Claude Code 的實作規格 / 「執行契約」。**P6 = Workstream A（引擎校正升級 dc-v1.1）+ Workstream B（value 計算機 v2：雙模式 + 人性化 + 在地化）。**
> 風格遵循專案原則：**verify-don't-assume**、**data integrity over approximation**、**fail-loud**、**idempotent**、**provenance**。對齊 [P0-P1-spec.md](P0-P1-spec.md)、[P3-spec.md](P3-spec.md)、[P5-spec.md](P5-spec.md)、[CLAUDE.md](../CLAUDE.md)。
> **本檔尚未實作；待 user review 通過後才動 code**（沿 P5 慣例）。
> ⚠️ 本 spec **修訂**了 P3/P5 的部分已定案條款（value 隔離原則、TV4/TV8/TU6、model_total_lines 用途）。修訂清單集中在 §6——**動 code 前先讀 §6**，被取代條款以本檔為準。

---

## 0. Scope

**Workstream A — 引擎校正升級（P1 的「設計更好」）：**
- **A1** 地主 HFA 啟用：16 球場→國家 lookup，US/CA/MX 主場 `is_host_home=true`。
- **A2** 歷史賽果擬合 → **dc-v1.1**：用公開國際賽歷史賽果 + 既有 Elo 年度快照，擬合 `BASE/GAMMA/HFA_ELO/RHO`（補上 P0-P1 §5.0 承諾、P3 沒做的 backtest）。
- **A3** 市場分歧診斷：賽前比對 72 場模型 vs Pinnacle 去 vig 的系統性偏差，輸出報告。

**Workstream B — value 計算機 v2（Feature 5 改版，使用者 = 台灣 + 加拿大親友）：**
- **B1** 市場模式人性化：紅黃綠三級判定 + 「貴多少」+ 打平勝率 + 同線比價。
- **B2** 模型機率模式：與市場模式明確切換；實驗標籤；永遠並列市場參考。
- **B3** totals 線格：`model_total_lines` 擴充為 1.5–4.5（0.25 步距）線格；模型模式 push-aware 精確 EV。
- **B4** Kelly 解鎖閘：模型模式 Kelly **校正達標才開**（n≥30 且 Brier ≤ 市場×1.1）。
- **B5** 在地化：zh-TW / en(加拿大) 的賠率格式預設、幣別、分地區負責任博弈資源、白話術語。
- **B6** 分歧場次清單：/value 頁列模型與市場分歧最大的場次（計算機入口）。

**明確不在 P6：**
- **賽中 Elo 更新 + re-predict**（user 裁決本輪不做 → §10）。
- 市場混合 / shrink-to-market 模型版本、Shin's 去 vig、totals 校正、歷史**收盤賠率**擬合（免費拿不到，→§10）。
- P4 球員 props（仍然不要提前實作）、個人 CLV、使用者帳號。

---

## 1. Decisions locked（2026-06-09，user 裁決）

1. **預設模式永遠 = 市場（Pinnacle 去 vig）**。模型模式是明確的 opt-in 切換，卡片視覺隔離 + 實驗標籤，且**永遠並列市場公平機率對照**（有盤時）。兩模式**永不混算**。
2. **模型模式 Kelly 校正達標才解鎖**：最新校正結果 `n_settled ≥ 30` 且 `model_brier ≤ market_brier × 1.1`（即 P3 §6 的參考門檻，從「參考」升級為這一個開關的實際條件）。未達標 → 模型模式只出 EV + 校正進度，不出注額。市場模式 Kelly 不受影響（維持 ¼）。
3. **totals 模型模式用預算線格** 1.5–4.5、0.25 步距（13 條）；市場模式維持只認 Pinnacle 主線（line-mismatch 規則不變）。
4. **市場模式判定 = 紅黃綠三級**：🟢 好價（EV>0）/ 🟡 接近公平 / 🔴 偏貴，附「比公平價貴 X%、每注 100 平均虧 Y」與打平勝率對照。
5. **A 範圍 = A1 + A2 + A3**；賽中 Elo 更新不在本輪。
6. **沒有 Pinnacle 盤的場次，任何模式都不出 EV/value**（P5 §6.1 維持不變）——沒有市場對照的模型 EV 正是最危險的輸出。
7. **隔離原則是「修訂」不是「放棄」**：從「value 路徑碰不到模型」改為「**來源必須標示、預設市場、永不混算、模型側永遠帶市場對照**」。程式層仍保證：`engine/value.py` / `web/lib/value.ts` 的算術**不 import 任何模型或市場資料**（純函數吃呼叫端給的機率——本來就是這樣，維持）。
8. **UI 永遠只呈現單一 active 模型版本**（2026-06-09 review R5 裁決）：「含/不含歷史擬合」兩版本（dc-v1.0 / dc-v1.1）只在 DB 與校正層並存對照（TA5），**不做使用者可切換的雙模型**——對目標使用者徒增混淆、放大「模型被當答案」風險、Kelly 閘還得 per-version 維護狀態，得不償失。v1.1 驗證沒過就繼續用 v1.0。

---

## 2. Workstream A — 引擎校正升級

### 2.1 A1 — 地主 HFA 啟用

P0 時 `is_host_home` 一律 false（trap：football-data match 物件不保證有 venue）。現在補齊：

```
HOST_TEAMS = {US, CA, MX}                    # Elo 兩碼（P0-P1 §4.2 既有）
STADIUM_COUNTRY = { <16 球場名> : 'US'|'CA'|'MX' }   # 手工策展表，放 etl/ 常數

fixtures ingest 增補：
  venue = f.venue or MANUAL_VENUE[f.match_id]    # API 缺 venue → 手工表補；兩邊都沒有 → raise（fail-loud）
  is_host_home = (home_id in HOST_TEAMS) and (STADIUM_COUNTRY[venue] == home_id)
```

- **MANUAL_VENUE 只需涵蓋地主三國出賽場次**（其餘場次 venue 缺就維持 false + warn，不 raise——非地主場次 HFA 無作用）。
- 策展來源 = FIFA 官方賽程；抽查 3–5 場 cross-check（TF5 模式）。⚠️ 注意 MX 三主場（Azteca/Guadalajara/Monterrey）與 US 場館的城市同名陷阱（如多個 "Levi's Stadium" 拼法）→ 表內用 football-data 回傳的原字串當 key。
- ingest 重跑（idempotent）後 → **re-predict 未開賽場次 + 重跑 simulate**。已結算場次不動。
- `HFA_ELO` 數值：A2 擬合出來前先沿用先驗 100；A2 完成後用擬合值（見 §2.2）。

### 2.2 A2 — 歷史賽果擬合 → dc-v1.1

> 這節是 user 點名要討論的「怎麼擬合、有哪些陷阱」。方法論 + 陷阱全部寫死在這裡；impl 不得自行改設計，發現對不上 → 標記回 spec。

#### 2.2.1 資料

| 項目 | 內容 |
|---|---|
| 賽果來源（候選） | Kaggle `martj42/international_results`（CC0；1872– 全部國際 A 級賽；欄位 `date, home_team, away_team, home_score, away_score, tournament, city, country, neutral`）。**impl 第一步 = 驗證**：license 仍 CC0、欄位齊、更新到 2026、列數合理；放 `etl/data/raw/intl_results/` + provenance README（同 Elo CSV 慣例，git-ignored） |
| ⚠️ 比分定義 | 該資料集比分**含延長賽、不含 PK**。污染量化見陷阱 #3 |
| 歷史 Elo | **既有 Elo CSV 的年度快照**（127 年 × 48 隊；P0-P1 §2.1 已 ingest 的同一檔）。不抓新來源 |
| 樣本窗 | `ERA_START = 2010-01-01` 起（可調常數）。避開隊名變更年代 + 現代進球率環境 |
| 樣本條件 | **兩隊都 ∈ WC2026 的 48 隊**（只有這 48 隊有歷史 Elo）。隊名 → team_id 走 fit script 內建 alias 表（fail-loud：對不上且出現次數 ≥ 門檻 → raise；一次性怪名 → 列入 report） |
| 快照覆蓋 guard | 每場**兩隊都要有賽前快照**才入樣（年度快照有缺年：4,683 列 < 127×48=6,096，部分隊歷史較短）。缺 → **丟該場並計數**，REPORT 揭露 drop rate；drop rate ≥ 5% → 標記回 spec（不准默默縮樣本） |
| 樣本量 guard | `assert n_matches >= 750`（≈1500 team-rows，4 個參數綽綽有餘）。不足 → 放寬 ERA_START 至 2005；再不足 → 標記回 spec 討論（fallback：抓 eloratings.net 全量歷史，做成新 `RatingSource`，本輪不預設做） |

#### 2.2.2 賽時 Elo 重建（⚠️ 本節是最大陷阱區）

```
rating_at(team, match_date) = 該隊「snapshot_date 嚴格早於 match_date」的最新年度快照
```

- **禁止向後內插**：match 在 2015-06，用 2014-12-31 與 2015-12-31 內插看似更準，但 2015-12-31 的值**包含這場比賽之後的賽果** → look-ahead leakage，擬合品質虛胖。**只准用賽前快照**（leak-free）。
- 代價 = 評分最多陳舊 12 個月 → errors-in-variables → **GAMMA 系統性低估（attenuation）**。處置：(a) report 必附 sensitivity：用「中點內插」變體重跑一次**只當診斷**（兩版 GAMMA 的差距即 attenuation 量級）；(b) 與 T9 錨點 cross-check（見 2.2.4）。

#### 2.2.3 擬合（兩階段，標準 DC 做法）

**Stage 1 — Poisson GLM（λ 參數）**。每場拆兩列（team 視角）：

```
log λ_team = α + β·(elo_team − elo_opp)/400 + η·home_sign + f·friendly_flag
home_sign = +1（該隊是 home 且非中立）｜ −1（對手是 home 且非中立）｜ 0（中立場兩隊皆 0）
```

- ⚠️ **必須用 signed indicator，不可用 0/1 home_flag**（review R2 抓到的 spec bug）：引擎把 HFA 加在 Elo 差 `d` 上（[engine/dixon_coles.py](../engine/dixon_coles.py)），**同時抬升 λ_home、壓低 λ_away**（對稱）；0/1 flag 只抬主隊不壓客隊，與引擎不等價。signed 版逐式代數等價：主隊列 `+η`、客隊列 `−η`，對應引擎的 `±GAMMA·HFA/400` ⇒ `HFA_ELO = 400·η/β` 是**精確**換算，非近似。
- **Round-trip sanity check（TA7）**：用擬合出的 `(BASE, GAMMA, HFA_ELO)` 代回 `elo_to_lambdas(elo_h, elo_a, is_host_home=True)`，輸出須與 GLM 直接預測的 `(λ_home, λ_away)` 一致（容差 1e-9）——機械防止換算式與引擎施加方式日後漂移。
- REPORT 附**不對稱診斷**：放開對稱限制（主隊抬升、客隊壓低各一參數）重擬，檢驗對稱假設；明顯不對稱 → 標記討論（引擎現行只支援對稱 HFA，不准默默改引擎）。
- `friendly_flag`：`tournament == 'Friendly'`（友誼賽強度低 → 用 covariate 吸收，不丟樣本）。
- 觀測權重 = 時間衰減 `w = 0.5^(Δyears / HALF_LIFE)`；`HALF_LIFE ∈ {∞, 2, 4, 8}` 年，用驗證集 log-loss 選（見 2.2.4）。
- 參數映射：`BASE = e^α`（friendly=0）、`GAMMA = β`、`HFA_ELO = 400·η / β`（精確，見上）。WC2026 套用時 friendly=0；HFA 只在 `is_host_home` 場次施加（A1）。
- 工具：`statsmodels` Poisson GLM（新增 dependency，進 `requirements.txt`）。信賴區間用 **match-clustered robust SE**（同場兩列相關，普通 SE 偏小）。

**Stage 2 — RHO（低分相依）**。固定 Stage-1 的 λ̂，對每場 (i,j) 比分以 DC τ 修正後的 score-matrix likelihood，grid search `RHO ∈ [−0.20, 0.05]`（同權重）取 max。沿用 T2 guard：所有格機率非負，否則該 RHO 不合法。

> 兩階段（先 λ 後 ρ）有輕微不一致，是 DC 文獻標準做法，documented、不追求 joint MLE。

#### 2.2.4 驗證與上線條件（PASS / FAIL）

- **時間切分**：train = ERA_START ~ 2023-12-31；validation = 2024-01-01 ~ 2026-06-08。**不准隨機切分**（時間序資料）。
- 指標：1X2 Brier / log-loss、totals(2.5) Brier，對兩個 baseline 同批比：(a) dc-v1.0 先驗參數、(b) Elo 官方 We 曲線 `We = 1/(1+10^(−d/400))` + 固定 draw 模型。⚠️ **兩個 baseline 都源自 Elo 體系**（陷阱 #11 circularity）——唯一外部基準是 A3 的市場對照，REPORT 須引用其結果。
- **上線條件：validation 1X2 log-loss，dc-v1.1 嚴格優於 dc-v1.0**。沒過 → 不 bump、報告留檔、標記回 spec 討論（不准硬上）。
- **T9 錨點降級為診斷**（對 v1.1）：64/76/91% 是 eloratings **自家評分系統的定義曲線**，不是進球資料的 ground truth。v1.1 用擬合參數重算 We@100/200/400，**report 揭露偏差**；偏差 >±0.05 要寫出解釋，但不自動 fail。dc-v1.0 的 T9 測試保留不動（它測的是先驗版引擎）。→ 此為對 P0-P1 spec §6 T9 的修訂，列入 §6 修訂清單。

#### 2.2.5 交付與版本並存

```
fit/fit_dc.py            ← 離線擬合 script（讀 raw CSV，不碰 Supabase）
fit/REPORT.md            ← 參數 + n + 信賴區間 + 衰減選擇 + 洲別平衡表 + sensitivity + T9 診斷
engine/dixon_coles.py    ← 常數更新（附 provenance 註解：資料集、區間、n、fit 日期）；MODEL_VERSION = 'dc-v1.1'
```

- `match_predictions` 主鍵含 `model_version` → **v1.0 既有列保留**，re-predict 未開賽場次寫 v1.1 列；`calibrate.py` 擴充為**對 DB 內所有版本同批計分**（賽中即可 v1.0 vs v1.1 對照）。
- 啟用版本 = 單一常數：Python 端 `engine.MODEL_VERSION`、web 端 `web/lib/constants.ts` 的 active model version——**同一個 change 一起 bump**（impl 時確認 web 現行讀法，不一致 → 標記）。
- **UI 永遠只呈現單一 active 版本**（§1.8）：雙版本只在 DB / 校正層並存對照，不做使用者可切換的雙模型。
- bump 後重跑：`etl.predict` → `etl.simulate` → `etl.model_lines`（線格，§3.4）。

#### 2.2.6 陷阱清單（已在上文處理，集中列出供 review）

1. **Look-ahead leakage**（年度快照向後內插）→ 只用賽前快照（2.2.2）。**最容易犯、最難察覺**。
2. **Elo 陳舊 → GAMMA attenuation** → sensitivity 變體 + T9 cross-check（2.2.2/2.2.4）。
3. **延長賽污染**：比分含 ET。只有「淘汰賽 90 分鐘打平」的場次受影響；對 2010+ 樣本占比 <1%，BASE 偏差 ≈ +0.005 → **接受並 document**，不為它砍掉正規賽事樣本（量化寫進 REPORT）。
4. **選樣偏差**：兩隊都 ∈48 → 樣本偏向「能打進世界盃等級」的對戰——這恰是目標域（WC 對戰就是這種）；但洲別占比會偏（UEFA/CONMEBOL 多）→ REPORT 附洲別平衡表。
5. **友誼賽強度** → covariate 吸收，套用時 f=0（2.2.3）。
6. **年代漂移** → ERA_START + 時間衰減 grid（2.2.3）。
7. **兩階段不一致**（λ 與 ρ 分開擬）→ 標準做法，documented（2.2.3）。
8. **T9 錨點 ≠ 真理** → 降為診斷（2.2.4）。
9. **歷史隊名映射** → fit script alias 表 fail-loud；ERA_START=2010 避開改名國（2.2.1）。
10. **樣本不足** → n guard + 兩段 fallback（2.2.1）。
11. **Elo 自我一致性（circularity）**（review R1）：eloratings 的評分本身就是從同一批歷史賽果算出來的——用它的賽前快照去擬合那些賽果，等於用「結果濃縮成的評分」回頭預測產生結果的比賽。**這不是 leakage**（每場只用賽前值），且部署時引擎同樣吃賽前 Elo（**訓練條件＝部署條件**），預測用途成立。但它意味著：(a) GAMMA 是「此評分系統 → 進球」的映射，**不可移植**到其他評分系統、也不是因果效應；(b) 歷史 holdout 成績對「Elo 系 baseline」的優勢可能虛胖——兩個驗證 baseline 也都源自 Elo 體系。處置：REPORT 明文揭露此限制；**唯一外部基準 = A3 市場對照**（Pinnacle 與 Elo 無共生關係），REPORT 必引；根治方案（per-match Elo replay）列 §10。

#### 2.2.7 時程判斷（開賽 6/11 前來不來得及）

- 機械部分（下載、mapping、GLM、RHO、報告）≈ 1 個工作天。**「開賽前完成且驗證可信」是 best-effort，不是承諾**——資料驗證或 mapping 卡住就會超過。
- **架構保證晚到也安全**：真正的硬規則是「**每場的預測必須在該場開賽前算好**」，不是「全部在 6/11 前」。v1.1 賽中落地 → re-predict 未開賽場次即可，已開賽場次的 v1.0 預測照常被校正計分，雙版本同批對照反而是有用資料。
- 開賽前優先序：**A1（半天）→ A3（半天）→ A2（best-effort）**。

### 2.3 A3 — 市場分歧診斷（賽前就能跑）

```
python -m etl.diagnose_market        # 新 job，read-only，不寫 DB
對 72 場（有 Pinnacle h2h + 有 active 版本預測）：
  模型 p_home/p_draw/p_away  vs  pinnacle_novig(h2h)
輸出（stdout + fit/DIAGNOSIS.md）：
  - mean signed diff（逐 outcome）：模型是否系統性高估強隊 / 低估 draw
  - mean |diff|、分布、top-10 分歧場次
  - totals：模型 P(over 主線) vs 市場去 vig（讀 model_total_lines）
```

- **用途是診斷模型，不是找 value**——報告開頭印免責一行。分歧大可能是模型錯（大概率）也可能是市場錯（小概率）。
- v1.0 與 v1.1 各跑一次 → 擬合前後對照。
- B6 的「分歧場次清單」是同一個比較的前端即時版（web server 算，與本 job 無共用 code 依賴）。

---

## 3. Workstream B — value 計算機 v2

### 3.1 模式架構

```
mode ∈ { market (預設), model (實驗) }
機率來源：
  market → pinnacle_novig（server 算好回傳；現行路徑）
  model  → h2h: match_predictions(active version)；totals: model_total_lines 線格（§3.4）
算術共用：evaluate(p, d, …) 本來就 source-agnostic —— value.ts/value.py 不改變「不 import 模型、不含 novig」的性質
```

硬性 UI 規則（修訂 P5 §6.1 的延伸，原則不變）：
- 模式切換器顯眼（「市場公平價」⇄「模型機率〔實驗〕」），**預設市場**；切到模型 → 結果卡片改用實驗配色（沿 ModelVsMarket 的 sky/amber 系）+ `ExperimentalTag strong`。
- **模型模式卡片內永遠並列市場公平機率**（「市場認為 48%，模型認為 55%」）；market 缺 → 不出 EV（decision #6），模型機率只能當展示。
- 模型模式永遠顯示**校正狀態列**：`已結算 n 場；模型 Brier x.xx vs 市場 x.xx` 或 `模型尚未經實戰驗證（已結算 0 場）`（資料來源 §3.5 的 calibration_runs）。
- 兩模式的數字**永不出現在同一個結果區塊裡混排**（對照列除外，且對照列必標來源）。
- **模式 → 機率選擇集中在單一純函數**（review R4）：`selectProb(mode, marketData) → { p, source }`，unit test 直測；結果卡片的來源標籤與傳入 `evaluate` 的 `p` **取自同一個回傳物件**——標籤不可能與實際使用的機率漂移。元件內**禁止**在 `selectProb` 之外讀另一來源的機率做任何計算。

### 3.2 市場模式人性化（B1）

取代二元 value/not value：

| 級 | 條件 | 顯示 |
|---|---|---|
| 🟢 好價 | `EV > 0` | 「比公平價還好 +X%」+（既有）Kelly ¼ 注額 |
| 🟡 接近公平 | `NEAR_FAIR_EV ≤ EV ≤ 0` | 「幾乎是公平價，水錢只有 X%」 |
| 🔴 偏貴 | `EV < NEAR_FAIR_EV` | 「比公平價貴 X%」 |

- `NEAR_FAIR_EV = −0.025`（可調常數，含意：好過典型主流書單邊水錢）。
- 三級都附兩行白話：
  - 「**每注 100 平均虧/賺 Y**」（`Y = |EV|×100`，盈虧方向跟符號）。
  - 「**打平需要勝率 1/d = X%；市場扣除抽水後認為是 p = Y%**」。
- 同線比價（line-shopping）保留，加一行主動句：「`<best book>` 有 `<best price>`，比你的 `<d_user>` 好」（best 即自己 → 「你的價已是追蹤書單中最佳」）。
- 三級閾值只作用於**呈現層**；`is_value ⇔ EV>0` 的算術定義不變（golden vectors 不因此重生）。

### 3.3 模型模式（B2）

- h2h：`p = match_predictions[active].p_{outcome}`。
- totals：`p` 取自線格（§3.4）；使用者線在 `[1.5, 4.5]` 且為 0.25 倍數 → 直接可算（**不再 line_mismatch**）；範圍外/非 0.25 步距 → graceful「此線超出模型支援範圍」不出 EV。
- EV/三級呈現與市場模式同款（共用元件），但卡片標示「以**模型機率**計算〔實驗〕」。
- Kelly：見 §3.5 解鎖閘。
- 市場參考列：同 outcome 的 `pinnacle_novig`（h2h 直接有；totals 線 = Pinnacle 主線時並列、非主線時標「市場主線 X 的參考價」）。

### 3.4 totals 線格 + push-aware 算術（B3）

**ETL（`etl/model_lines.py` 改版）**：每次 odds ingest 後（觸發點不變），對每場有預測的比賽，由 `lambda_home/away` 預算：

```
TOTALS_GRID = [1.50, 1.75, 2.00, …, 4.50]     # 0.25 步距，13 線
每線 upsert model_total_lines(match, point, model_version,
    model_p_over  = P(total > L),
    model_p_under = P(total < L),
    model_p_push  = P(total == L))             # 整數線才非 0；新欄位（§4 DDL）
Pinnacle 主線不在格上（理論上不會，主線必為 0.25 倍數）→ 照舊額外算該線
```

**算術（`engine/value.py` + `web/lib/value.ts` 各加，golden vectors 重生）**：

```
ev_with_push(p_win, p_push, d) = p_win·d − (1 − p_push)        # 整數線精確 EV
quarter（L = x.25/x.75）= 半注 L−0.25 + 半注 L+0.25：
    EV = ½·EV(下半線) + ½·EV(上半線)                            # 兩半線都在格上 → 精確
kelly_with_push: p_eff = p_win/(p_win + p_lose)；f* = (d·p_eff − 1)/(d − 1)
    # 推導自含 push 的 E[log] 一階條件，恰等於條件機率版二元 Kelly，無額外縮放
    # quarter 的 Kelly = 兩半線 f* 的等權平均 → 標「近似」（只有 Kelly 近似，EV 精確）
```

**「近似」旗標範圍修訂**（取代 P3 TV8 / P5 TU8 的 quarter-only 定義）：
- **市場模式**：精確僅 half line（x.5）；**整數線與 quarter line 都標「近似」**（市場兩邊去 vig 不含 push 資訊——整數線原本就近似，過去沒標，這次補誠實）。
- **模型模式**：EV 全格精確（push-aware）；quarter 的 **Kelly** 標「近似」。

### 3.5 Kelly 解鎖閘（B4）

```
資料源：calibration_runs 最新一列（active model_version；§4 DDL）
kelly_unlocked = (n_settled ≥ 30) and (model_brier ≤ market_brier × 1.1)
```

- 鎖定狀態**分兩種文案**，使用者才不會以為功能壞掉（review R3）：
  - `n < 30`（資料不足）：「**校正進度 n/30 場**——注額建議需至少 30 場已結算賽事驗證模型，預計小組賽中段解鎖」。進度數字必渲染（TB5）。
  - `n ≥ 30` 但 Brier 未達標：「**模型校正未達標**（Brier 落後市場逾 10%）——注額建議維持鎖定」。誠實顯示，不含糊。
- 時程預期（給文案/營運參考）：賽程約 4–5 場/日，n=30 約落在第 7–9 個比賽日（≈6/18–6/21），再加結果 ingest + calibrate 執行節奏，**實際解鎖估小組賽中後段**——這是預期行為，不是 bug。
- 解鎖後模型模式 Kelly 同 ¼（沿用既有常數），仍帶實驗標籤。
- `calibrate.py` 改版：每次執行把 summary **寫進 `calibration_runs`**（append，provenance = run_at）；無 settled 也寫（n=0），讓前端拿得到「進度 0/30」。
- 市場模式 Kelly 不經此閘（行為不變）。

### 3.6 在地化（B5）

| 項目 | zh-TW | en（主要受眾=加拿大） |
|---|---|---|
| 賠率格式預設 | `decimal`（台灣運彩即歐洲盤），選單第二順位 = 香港盤 | `decimal`，選單第二順位 = American |
| bankroll 欄位 | placeholder/幣別標 `TWD` | `CAD` |
| 負責任博弈 footer | 台灣在地資源（**文案人工策展**，不機翻；含合法管道提醒） | 安大略資源：ConnexOntario 1-866-531-2600、19+ 提示（人工策展） |
| 術語白話化（兩語） | 「去 vig」→「扣除抽水後的公平機率」；EV →「期望值（每注 100 平均賺賠）」；vig →「水錢/抽水」 | 同步改寫（plain English：fair probability after removing the bookmaker margin…） |

- 預設值由 locale 決定，使用者可改；是否記住選擇（localStorage）= impl 自由度，非驗收項。
- 全部走 `messages/{zh-TW,en}.json`，key 一一對應（TU1 既有測試自然涵蓋）。
- RG footer 文案屬「策展查表」性質（同隊名 name_zh 原則）：**spec 不內嵌最終文案，impl 開 PR 時由 user 審字**。

### 3.7 分歧場次清單（B6）

/value 頁頂部（計算機上方）server component：

```
對「未開賽 + 有 Pinnacle h2h + 有 active 版本預測」的場次：
  divergence = max over {home,draw,away} |model_p − pinnacle_novig_p|
取 top 10 降冪：對戰、開賽時間、該 outcome 的模型% vs 市場%、差距
點擊 → 預填計算機（match/market/outcome）
```

- 區塊帶 `ExperimentalTag` + 一行說明：「分歧大≠value；多半是模型錯」（i18n）。
- server 端即時算（讀既有資料，無新 ETL）；模型與市場數字並列呈現，符合 D5。

### 3.8 頁面流程 v2（取代 P5 §5.2）

```
0. （頂部）分歧場次清單〔實驗〕→ 點擊預填
1. 選比賽
2. 選模式：市場公平價（預設）⇄ 模型機率〔實驗〕
3. 選 market（1X2 / 大小分）+ outcome
   - totals 市場模式：自動帶 Pinnacle 主線；改線 → line_mismatch（不變）
   - totals 模型模式：線格內任意 0.25 線可算；格外 → graceful
4. 賠率格式（locale 預設）+ 輸入賠率（d≤1 即時錯誤，不變）+（選）bankroll
5. 結果卡片（按模式配色/標示）：
   - 🟢🟡🔴 三級 + 「每注100平均…」+ 打平勝率 vs 公平勝率
   - Kelly：市場模式照舊 ¼；模型模式經解鎖閘（§3.5）
   - 近似旗標按 §3.4 新規則
   - 模型模式：校正狀態列 + 市場參考列（必有）
   - line-shopping（同線，含主動比價句）
6. 負責任博弈 footer（分地區資源，§3.6）
```

---

## 4. Schema DDL（增量）

```sql
-- 4.1 model_total_lines：加 push 欄（整數線非零）；用途由「主線」擴為「線格」（§3.4）
alter table model_total_lines
  add column model_p_push numeric not null default 0;
-- 既有列重跑 etl.model_lines 後由 upsert 補正（PK 不變：match_id, point, model_version）

-- 4.2 校正結果落表（給 Kelly 解鎖閘 + 模型模式校正狀態列；§3.5）
create table calibration_runs (
  run_id        bigserial primary key,
  run_at        timestamptz not null default now(),
  model_version text not null,
  n_settled     int not null,
  model_brier   numeric,           -- n=0 時 null
  model_logloss numeric,
  market_brier  numeric,
  market_logloss numeric
);
create index calibration_runs_lookup on calibration_runs (model_version, run_at desc);
```

容量 sanity：線格 13 線 × 104 場 × ≤2 版本 ≈ 2,700 列，可忽略。

---

## 5. API 變更（`GET /api/value/market`）

回傳新增欄位（既有欄位不動，向後相容）：

```jsonc
{
  // ……既有欄位（pinnacle_novig / main_point / line_shopping / freshness …）……
  "model_h2h": {                       // market=h2h 才回；無預測 → null
    "model_version": "dc-v1.1",
    "p_home": 0.58, "p_draw": 0.24, "p_away": 0.18
  },
  "model_totals_grid": [               // market=totals 才回；無預測 → null
    { "point": 2.0, "p_over": 0.61, "p_under": 0.32, "p_push": 0.07 },
    // …13 線
  ],
  "calibration": {                     // calibration_runs 最新列；無列 → null（前端視同未解鎖）
    "model_version": "dc-v1.1", "run_at": "...",
    "n_settled": 0, "model_brier": null, "market_brier": null,
    "kelly_unlocked": false            // server 算好（§3.5 條件），client 不重判
  }
}
```

- 模式選擇與算術在 client（既有架構不變）；client 把「所選模式的 p」傳入 `evaluate` 系函數。`web/lib/value.ts` 維持不 import 模型/市場資料、不含 novig。
- 既有 `model_layer`（展示用）由 `model_totals_grid` 取代後**移除**（避免兩份模型資料並存）；/matches 不受影響。
- 回傳仍是聚合值，無 raw odds 傾印（ToS 姿勢不變）。

---

## 6. 既有 spec 修訂清單（⚠️ 動 code 前先讀）

| 原條款 | 修訂 |
|---|---|
| P3 §1 決策 1「EV 比市場、不比模型」 | → 「**預設**比市場；模型機率是明確切換的第二模式（實驗標籤、並列市場、永不混算）」（本檔 §1.1/§3.1） |
| P3 TV4 / P5 TU6 / D4「value 路徑只吃 pinnacle_novig；模型機率程式層斷開」 | → 算術層不變（純函數、不 import）；**路徑層改為來源標示制**：market 模式只吃 pinnacle_novig；model 模式只吃模型機率；UI 永不混算 → 新測試 TB8 取代 TV4/TU6 的路徑部分 |
| P3 §5.3 Kelly「預設 ¼、負 EV→0」 | 市場模式不變；**模型模式加解鎖閘**（§3.5） |
| P3 TV8 / P5 TU8「quarter line 標近似」 | → **市場模式：非 half line（整數 + quarter）都標近似；模型模式：EV 精確、quarter Kelly 標近似**（§3.4）→ TB7 |
| P3 §3.3/§4.4/TO8「model_total_lines = Pinnacle 主線」 | → 擴為線格 1.5–4.5 + `model_p_push` 欄（§3.4/§4）→ TB11 取代 TO8 |
| P3 §6 / T10「n≥30–40 再談**參考**門檻」 | → 同條件升級為**模型模式 Kelly 的實際開關**（僅此用途；校正本身仍非模型上線 gate）；calibrate.py 落表（§3.5） |
| P5 §5.2 頁面流程 | → 本檔 §3.8 取代 |
| P5 §6.1「無市場 → 絕不出 value/EV」 | **維持不變**，明確適用兩模式（§1.6） |
| P0-P1 §6 T9（We 錨點 ±0.03） | 對 dc-v1.0 保留；**對 dc-v1.1 降級為診斷**（§2.2.4） |
| P0-P1 §2.2 / §4.2「is_host_home v1 一律 false」 | → A1 啟用（§2.1） |
| CLAUDE.md | 現況加 P6；trap #12「EV 比 Pinnacle 去 vig 不比模型」改寫為雙模式版本；指令加 `fit/fit_dc.py`、`etl.diagnose_market`；trap 新增「歷史擬合禁止向後內插（leakage）」 |

> 修訂生效後，`web/tests` 既有斷言（TU6/TU8 對應檔）需同步改寫；`engine/value.py` 動了 → **重生 golden_vectors**（CLAUDE.md trap #13c 既有流程）。

---

## 7. 驗收測試（PASS / FAIL）

### Workstream A

| ID | 測試 | 通過條件 |
|---|---|---|
| **TA1** | venue lookup | 地主三國全部場次 `is_host_home` 正確（對 FIFA 官方賽程抽查 3–5 場）；地主場次 venue 缺 → raise；非地主場次缺 venue → false + warn 不 raise |
| **TA2** | HFA 生效 | re-predict 後，地主主場場次 `lambda_home` 高於同對戰中立場版本（T8 引擎測試既有；此處驗 ETL 串接） |
| **TA3** | fit 資料品質 | license/欄位驗證通過；隊名 unmapped（高頻）=0；`rating_at` 全部 snapshot_date < match_date（**零 leakage**，硬 assert）；快照缺漏丟場 drop rate < 5%（REPORT 揭露）；n ≥ 750 |
| **TA4** | fit 驗證 | 時間切分；validation 1X2 log-loss v1.1 < v1.0 才准 bump；REPORT 含洲別平衡、衰減選擇、sensitivity、T9 診斷 |
| **TA5** | 版本並存 | `match_predictions` 同場可有 v1.0 + v1.1 列；web/simulate 讀 active 常數；`calibrate.py` 對所有版本同批計分 |
| **TA6** | 分歧診斷 | `etl.diagnose_market` 輸出逐 outcome signed bias + top-10 分歧 + 免責行；read-only（不寫 DB） |
| **TA7** | HFA round-trip | 擬合 `(BASE, GAMMA, HFA_ELO)` 代回 `elo_to_lambdas(…, is_host_home=True)`，與 GLM 直接預測的 `(λ_home, λ_away)` 一致（容差 1e-9）——`HFA=400·η/β` 換算與引擎施加方式等價的機械驗證 |

### Workstream B

| ID | 測試 | 通過條件 |
|---|---|---|
| **TB1** | 預設模式 | 計算機初始 = 市場模式；模型模式需明確切換 |
| **TB2** | 模型模式並列 | 模型模式卡片含市場參考列（有盤時）+ ExperimentalTag + 校正狀態列 |
| **TB3** | 無盤不出 EV | 無 Pinnacle → 兩模式皆不出 EV/value/Kelly（graceful 訊息） |
| **TB4** | 三級判定 | 🟢/🟡/🔴 邊界（EV>0 / ≥−0.025 / 其餘）正確；「每注100」「打平勝率」數字與 EV、1/d、p 一致 |
| **TB5** | Kelly 閘 | calibration null/n<30 → 無 Kelly + **渲染進度數字「n/30」**；n≥30 但 ratio>1.1 → 無 Kelly + 渲染「校正未達標」文案（兩種鎖定狀態文案可區分）；達標 → ¼ Kelly；市場模式恆不受閘 |
| **TB6** | push-aware 算術 | `ev_with_push` / quarter 組合 / `kelly_with_push` 與 `engine/value.py` 黃金向量一致（重生 golden_vectors） |
| **TB7** | 近似旗標 v2 | 市場模式：half 線無旗標、整數與 quarter 有；模型模式：EV 無旗標、quarter Kelly 有（取代 TV8/TU8） |
| **TB8** | 隔離 v2 | (a) 靜態：`value.ts`/`value.py` 不 import 模型/市場資料、不含 novig（沿用）；(b) `selectProb` unit test：每 mode 回傳正確 `(p, source)`；(c) **可區分夾具數值斷言**：夾具給 `pinnacle_novig=0.40`、模型 p=0.70（明顯可分）→ market 模式渲染的 EV 必須**恰等於** `evaluate(0.40, d)`、model 模式恰等於 `evaluate(0.70, d)`——任何混算/平均都會撞錯數字；(d) 來源標籤與所用 p 出自同一 `selectProb` 回傳物件（取代 TV4/TU6 路徑部分） |
| **TB9** | 在地化 | zh-TW 預設 decimal+TWD、en 預設 decimal+CAD（American 第二順位）；RG footer 依 locale 出對應資源；字典 key 對齊 |
| **TB10** | 分歧清單 | 依 max |model−market| 降冪 top10；帶實驗標籤 + 免責行；點擊預填正確；無資料 graceful |
| **TB11** | 線格 | 每場（有預測者）13 線齊 + `p_over+p_under+p_push≈1`；整數線 p_push>0、half/quarter 線 p_push=0；由 λ 重算非 p_over_2_5（取代 TO8） |
| **TB12** | 校正落表 | `calibrate.py` 每次執行 append `calibration_runs` 一列（含 n=0）；API `calibration.kelly_unlocked` 由 server 判定 |

> 純算術（TB4/TB6/TB7）離線可測（vitest + pytest 黃金向量）；TB1/TB2/TB3/TB5/TB10 走 component test（Testing Library，斷言走字典值不碰 class，沿 P5 §7.1 慣例）。

---

## 8. 設計風險清單

1. **模型模式被當「答案」**（最高風險，與 P5 風險 #1 同源）→ 預設市場、實驗配色、永遠並列市場參考、校正狀態列、Kelly 閘（§3.1/§3.5）。
2. **歷史擬合 leakage / attenuation** → 賽前快照硬規則 + assert（TA3）+ sensitivity（§2.2.2）。
3. **擬合趕工上線**（開賽壓力）→ 上線條件是 validation 硬門檻（TA4），沒過不 bump；架構允許賽中落地（§2.2.7）。
4. **隔離條文修訂被誤讀為「可以混」** → §6 修訂清單白紙黑字 + TB8 程式層測試。
5. **Kelly 閘長期鎖定**（小組賽前兩週 n<30 必然鎖）→ 預期行為，UI 顯示進度而非報錯；文案講清楚。
6. **近似旗標範圍變更**影響既有 golden vectors / 測試 → §6 列明重生流程，一個 PR 內同步。
7. **三級閾值（−2.5%）誤導**「🟡=可以買」→ 文案明示 🟡 仍是負 EV（「水錢低，但仍是付費娛樂」）。
8. **RG 文案機翻風險** → 策展查表原則，user 審字（§3.6）。
9. **雙版本並存的讀取混亂** → active 版本單一常數、Python/TS 同 change bump（TA5）。
10. **model_layer 移除**是 API breaking change → 同 PR 內改完前端唯一呼叫點，無外部消費者。
11. **「來源標示制」的執法強度天生弱於「程式層斷開」**（review R4；原 TV4 的硬保證被換掉了，這是本次修訂的代價）→ 三層補強：`selectProb` 單一選點（§3.1）、可區分夾具的精確數值斷言（TB8c）、來源標籤與 p 同物件（TB8d）。靜態掃描只是第一層，不能只靠它。

---

## 9. 時程（今天 = 2026-06-09；開賽 = 6/11）

| 時點 | 內容 |
|---|---|
| 6/9 | 本 spec user review |
| 6/10 | **A1**（半天，含 re-predict/simulate）→ **A3**（半天）→ **A2** 資料驗證 + 首次擬合（best-effort） |
| 6/11 開賽前 | A2 驗證通過 → bump v1.1 + re-predict；未通過/未完成 → v1.0 照跑，**不影響任何功能**（硬規則只有「逐場預測先於該場開賽」） |
| 開賽第 1 週 | **B1/B5**（市場模式人性化 + 在地化，純前端先上）→ **B3/B2**（線格 ETL + 模型模式）→ **B4/B6**（Kelly 閘 + 分歧清單） |
| n≥30（約小組賽中後段） | Kelly 閘有機會解鎖；calibrate 例行跑（隨 odds ingest 節奏） |

---

## 10. 之後（不在 P6）

- **賽中 Elo 更新 + re-predict**（`EloRatingsTsvSource` adapter；本輪 user 裁決不做）。
- **自算 per-match Elo replay（`ComputedEloSource`，P0 已預留介面）**：對 martj42 全史重放 Elo 更新 → 逐場賽前評分（根治 12 個月陳舊 attenuation）+ 全隊覆蓋（解除「兩隊都 ∈48」選樣限制）。circularity 本質仍在（評分永遠來自賽果），但 staleness 與選樣兩個陷阱一次根治。代價：需複刻 eloratings 公式（K 值分級/進球差乘數/主場 100），工程量大且要逐項驗證 → 列 dc-v1.1 之後的升級路徑。
- shrink-to-market / 混合模型版本、Shin's 去 vig、totals 校正、歷史**收盤賠率**擬合（資料取得後）。
- 平台預設集（「我用的平台」一鍵帶格式）、使用者偏好持久化、個人 CLV。
- P4 球員 props（仍不提前實作）。

---

## 11. 裁決紀錄（2026-06-09 user review round 1，已併入上文）

- **R1（Elo circularity）**：成立、原陷阱清單漏列。非 leakage、訓練條件＝部署條件故預測用途成立；但 GAMMA 不可移植、holdout 對 Elo 系 baseline 的優勢可能虛胖 → 陷阱 #11 + REPORT 揭露 + **A3 市場對照升格為唯一外部基準**（§2.2.4）；根治（per-match Elo replay）列 §10。
- **R2（HFA 換算）**：**user 抓到 spec bug**——原 0/1 `home_flag` 只抬主隊不壓客隊，與引擎「HFA 加在 d 上、對稱抬壓」**不等價**。改 signed indicator（`η·home_sign`），`HFA=400·η/β` 成為精確換算；加 TA7 round-trip 機械驗證 + 不對稱診斷（§2.2.3）。
- **R3（Kelly 閘時程）**：n=30 估第 7–9 比賽日（≈6/18–6/21）+ ingest/calibrate 節奏 → 實際解鎖小組賽中後段。鎖定文案分「資料不足（渲染 n/30 進度）」與「校正未達標」兩種，TB5 驗渲染（§3.5）。
- **R4（TB8 執法強度）**：成立、原風險清單漏列。「來源標示制」弱於「程式層斷開」是本次修訂的代價 → 三層補強：`selectProb` 單一選點、可區分夾具精確數值斷言、標籤與 p 同物件（§3.1 / TB8 / 風險 #11）。
- **R5（要不要兩種 model 並存）**：裁決**不做使用者可切換雙模型**。DB / 校正層已天然雙版本並存對照（TA5、calibrate 逐版本計分），比較的好處免費拿到；UI 單一 active 版本（§1.8），v1.1 沒過驗證就留在 v1.0。

---
P6 spec 草案 2026-06-09（§1 八項裁決；review round 1 R1–R5 已併入，見 §11）。**待 user review 通過後動 code。**
