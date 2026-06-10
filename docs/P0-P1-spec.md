# World Cup 2026 Analytics — P0 / P1 Spec

> ⚠️ **部分條款已被 [P6-spec.md](P6-spec.md) §6 修訂**（§2.2/§4.2 `is_host_home` 由 P6 A1 啟用；T9 We 錨點對 dc-v1.1 降為診斷）。動引擎/HFA/校正前以 P6 為準。
> 給 Claude Code 的實作規格。設計討論在 Claude.ai 完成，這份文件是「執行契約」。
> 風格遵循專案原則：**verify-don't-assume**、**data integrity over approximation**、**spec 與 code 不符要立即標記**。

---

## 0. Scope

**本 spec 只涵蓋 P0 + P1。** 兩者耦合（引擎需要 schema），所以一起寫。

- **P0** — 資料層：Supabase schema、Elo ingestion（讀 CSV → `teams`）、fixtures ingestion（→ `matches`）、identity mapping。
- **P1** — 預測引擎：Dixon–Coles Poisson engine，讀 `teams` + `matches` → 寫 `match_predictions`。交付 **Feature 1（1X2 + 爆冷）** 與 **Feature 3（大小分）**。

**明確不在本 spec：**
- P2 Monte Carlo 晉級模擬（Feature 4）
- P3 EV 計算機 + CLV / line-shopping（Feature 5）
- P4 球員 anytime-goalscorer props（Feature 2，直接用市場賠率，不自建模型）
- 八字（v1 不做）

---

## 1. Decisions locked（背景，已對齊）

1. **Feature 5 = A 為底 + B（line-shopping / CLV）為核心邏輯。** → P3 必須接一條 sharp 參考線（Pinnacle）並做去 vig 比對。影響 P3，不影響本 spec，但 schema 預留空間。
2. **Team rating = World Football Elo。** v1 讀現成 WC2026 Elo CSV（來源 eloratings.net，CC BY-SA 4.0）。**rating 來源做成 adapter**，可換成即時抓 TSV 或自算 Elo。
3. **市場效率前提（給 P3 的提醒，但現在就要記住）**：收盤賠率去 vig 後幾乎是最準的機率。自建模型的目標是「校正得跟市場一樣好」，不是「贏過市場」。本引擎的輸出在 UI 上**必須與市場賠率並列**，不可單獨呈現為「正確答案」。
4. **Feature 2 用市場 props，不自建球員模型。**

---

## 2. 資料來源

### 2.1 Team ratings（Elo）

| 項目 | 內容 |
|---|---|
| v1 來源 | WC2026 專用 Elo CSV（Kaggle，CC BY-SA 4.0，源自 eloratings.net） |
| CSV 欄位 | `country`(→name_en)、`country_code`(canonical key)、`rating`(→elo)、`snapshot_date`、`confederation`、`is_host` |
| ⚠️ 多 snapshot | 4,683 列 = 127 年快照 × 48 隊（含每隊一列 live）。**ingest 取每隊「不在未來」的最新快照**（見 §4.1）——直接 `max()` 會抓到 future-dated 的年底欄位（如 2026-12-31，數值複製自 live），provenance 變假。 |
| Canonical key | 用 CSV 的 `country_code`（eloratings 兩碼，如 `EN`/`KR`/`BR`）當 `team_id`。**不要 hardcode FIFA 三碼**——沒有來源原生提供，硬背容易錯（CRO vs CRC 之類）。team_id 是內部 key，使用者看的是 name_en/name_zh。 |
| 授權義務 | 標註來源 + share-alike（站上放 attribution footer） |
| 檔案位置 | `etl/data/raw/elo/elo_ratings_wc2026.csv`（Kaggle 原檔名，無日期後綴；真實 as-of 來自 CSV 的 `snapshot_date` 欄 → 存進 `teams.elo_asof`，不靠檔名）。README 留旁邊。 |
| Adapter | `RatingSource` 介面：`get_ratings() -> list[{team_id, name_en, elo, asof, confederation, is_host}]`。v1 = `CsvRatingSource`（含 max-snapshot filter）。未來可加 `EloRatingsTsvSource`（即時）或 `ComputedEloSource`（自賽果算）。 |

**避坑**：`api.clubelo.com` 是俱樂部 Elo，**不可**用於國家隊。

### 2.2 Fixtures / 分組 / 隊伍（來源已定：football-data.org）

- 分組已抽完（12 組 A–L，每組 4 隊）。賽程 6/11–7/19。
- **來源 = football-data.org v4**（免費 tier 即含 World Cup，10 calls/min；有 fixtures/standings/scorers，無賠率——賠率走 The Odds API）。
- Base `https://api.football-data.org/v4`，HTTP header `X-Auth-Token: <TOKEN>`，token 存環境變數 **`FOOTBALL_DATA_TOKEN`**（⚠️ env 變數名不可用連字號——GitHub Actions secret / shell `export` 都不吃 `-`；連字號的是 HTTP header，不是 env 名）。免費註冊取得，勿進 git。

P0 用到的 endpoint（每次 refresh 約 3 calls，遠低於 10/min；rate limit 打在 ETL 上，非網站訪客）：

| 用途 | call |
|---|---|
| 全部 104 場 | `GET /v4/competitions/WC/matches?season=2026` |
| 48 隊（name + tla 三碼） | `GET /v4/competitions/WC/teams?season=2026` |
| 12 組分組積分（P2/賽中） | `GET /v4/competitions/WC/standings?season=2026`（LEAGUE_CUP → 每組一張表） |

match 物件要 map 的欄位：`id`、`utcDate`、`status`、`stage`、`group`、`homeTeam.{name,tla}`、`awayTeam.{name,tla}`、`score.fullTime.{home,away}`。

**enum → 內部值：**
- `stage`：`GROUP_STAGE`→`group`、`LAST_32`→`r32`、`LAST_16`→`r16`、`QUARTER_FINALS`→`qf`、`SEMI_FINALS`→`sf`、`THIRD_PLACE`→`3rd`、`FINAL`→`final`
- `group`：`GROUP_A`..`GROUP_L` → 取字母 `A`..`L` 存 `matches.group_label`

**⚠️ venue / is_host_home**：match 物件**不保證有 venue** → v1 `is_host_home` **預設 false（中立）**，地主主場優勢當 later refinement（之後可用官方賽程補一張 16 球場→國家 lookup）。

**隊碼三套不同 → alias seeding**：football-data 用三碼 `tla`（NED/MEX/KOR）+ 全名；Elo 用兩碼 `country_code`（NL/MX/KR）。做法：拉 `/WC/teams`（48 隊 name+tla），跟 Elo 48 隊（country+country_code）**用正規化 name join**，自動對上大多數，再**人工修**對不上的（Türkiye/Turkey、Côte d'Ivoire/Ivory Coast、Korea Republic/South Korea、Congo DR/DR Congo…）。alias 同時收 name 和 tla → team_id。

**介面**：`FixtureSource.get_fixtures() -> list[{match_id, stage, group_label, home_tla, home_name, away_tla, away_name, kickoff_utc, status}]`。v1 = `FootballDataFixtureSource`。

### 2.3 ⚠️ Identity mapping（跨來源隊名不一致）

Elo / odds / fixtures 對同一隊拼法不同（`United States`/`USA`、`Korea Republic`/`South Korea`、`Türkiye`/`Turkey`、`Côte d'Ivoire`/`Ivory Coast`…）。

**規則：所有來源的隊名都必須經過 `team_aliases` 解析成 `team_id`。對不上的隊名 → ETL 直接 raise，不准默默新增 team。**（這是 verify-don't-assume 的硬性 gate。）

---

## 3. Schema DDL（Supabase / Postgres）

```sql
-- 3.1 國家隊
create table teams (
  team_id        text primary key,          -- = eloratings country_code（兩碼，如 'EN'/'KR'/'BR'）；內部 join key
  name_en        text not null,
  name_zh        text,                       -- zh-TW 顯示名（i18n）；用「策展查表」非機器翻譯
  confederation  text,                       -- UEFA / CONMEBOL / CONCACAF / ...
  elo            numeric not null,           -- 賽前 Elo snapshot
  elo_asof       date    not null,           -- snapshot 日期（provenance）
  group_label    char(1)                     -- 'A'..'L'
);

-- 3.2 隊名別名（identity mapping）
create table team_aliases (
  alias    text primary key,                 -- 原始來源拼法，如 'United States'
  team_id  text not null references teams(team_id),
  source   text                              -- 'elo' | 'odds_api' | 'fixtures'（除錯用）
);

-- 3.3 賽程
create table matches (
  match_id     text primary key,             -- 來自 fixtures source 的穩定 id
  stage        text not null,                -- 'group' | 'r32' | 'r16' | 'qf' | 'sf' | 'final'
  group_label  char(1),                      -- group 賽填 'A'..'L'，淘汰賽 null
  home_team    text not null references teams(team_id),
  away_team    text not null references teams(team_id),
  kickoff_utc  timestamptz not null,
  venue        text,
  is_host_home boolean not null default false,-- home_team 是地主國且在本國比賽時 = true（主場優勢開關）
  status       text not null default 'scheduled', -- 'scheduled' | 'live' | 'final'
  home_goals   int,
  away_goals   int
);

-- 3.4 模型輸出（每 (match, model_version) 一列）
create table match_predictions (
  match_id        text not null references matches(match_id),
  model_version   text not null,             -- 如 'dc-v1.0'
  lambda_home     numeric not null,          -- 期望主隊進球
  lambda_away     numeric not null,
  p_home          numeric not null,          -- 1X2
  p_draw          numeric not null,
  p_away          numeric not null,
  p_over_2_5      numeric not null,          -- 大小分（總進球 >= 3）
  p_btts          numeric,                   -- both teams to score（matrix 免費附帶）
  exp_total_goals numeric not null,
  computed_at     timestamptz not null default now(),
  primary key (match_id, model_version)
);
```

**i18n 註記**：`name_zh` 用策展查表（西班牙 / 阿根廷 / 法國 …），**不要機器翻譯國名**（會出錯）。

---

## 4. ETL 契約（P0）

通則：**所有 ETL job 必須 idempotent（upsert）**、**fail-loud（對不上的隊名/缺欄位直接報錯）**、**記錄 provenance（asof / source）**。

### 4.1 Elo ingest
```
df = read_csv(elo_csv_path)
# ⚠️ 檔案含「未來年底欄位」(如 2026-12-31)，其數值複製自當期 live 快照(此例 2026-05-27)。
#    直接 max(snapshot_date) 會抓到未來日期：數值對，但 provenance(as-of) 變假。
#    規則：只取「不在未來」的快照。
df = df[df.snapshot_date <= today()]
df = latest_per_team(df)                     # 每隊留剩下的 max(snapshot_date)；此例 = 2026-05-27
assert len(df) == 48                         # 48 隊到齊，否則 raise
assert df.country_code.is_unique             # canonical key 唯一
assert df.rating.notna().all()               # 無 null rating
assert df.snapshot_date.max() <= today()     # as-of 不得是未來日期
for r in df:
    # Elo source 的 country_code 即 team_id（canonical），不走 alias
    upsert teams(team_id=r.country_code, name_en=r.country,
                 elo=r.rating, elo_asof=r.snapshot_date,   # 真實 as-of，非年底欄位
                 confederation=r.confederation)
```
> 註：`team_aliases` 是給 **odds / fixtures 等其他來源** 把它們的隊名對到此 `team_id` 用的，**不是給 Elo source 本身**——Elo 的 country_code 已是 canonical key。

### 4.1b Alias seeding（**必須在 fixtures ingest 之前**）
```
teams_fd = GET /WC/teams                       # 48 隊 name + tla
for t in teams_fd:
    team_id = match_by_normalized_name(t.name, teams.name_en)  # 對 Elo 的 name_en
    if team_id:
        upsert team_aliases(alias=t.name, team_id, source='fixtures')
        upsert team_aliases(alias=t.tla,  team_id, source='fixtures')
unmatched = 自動對不上的隊            # Türkiye/Turkey、Côte d'Ivoire/Ivory Coast 等
# -> 人工補 alias，直到 48 隊全有對應
assert 48 隊 name 都對到 team_id
```
> odds_api（P3）之後照同流程把它的隊名加進 `team_aliases`。

### 4.2 Fixtures ingest
```
fixtures = FootballDataFixtureSource.get_fixtures()   # /WC/matches?season=2026
for f in fixtures:
    home_id = resolve_alias(f.home_tla) or resolve_alias(f.home_name)  # 對不上 -> raise
    away_id = resolve_alias(f.away_tla) or resolve_alias(f.away_name)
    upsert matches(
        match_id=f.match_id, stage=STAGE_MAP[f.stage],
        group_label=letter_of(f.group_label),   # GROUP_F -> 'F'；淘汰賽 -> null
        home_team=home_id, away_team=away_id,
        kickoff_utc=f.kickoff_utc, status=f.status,
        is_host_home=False,                      # v1 預設中立（見 §2.2）
    )
```
`HOST_TEAMS = {US, CA, MX}`（Elo 兩碼）。`is_host_home` v1 一律 false；要做地主主場優勢時再補 16 球場→國家 lookup。

---

## 5. 預測引擎（P1）— Dixon–Coles

Python ETL job。讀 `teams` + 待預測 `matches` → 算 → 寫 `match_predictions`。

### ⚠️ 5.0 校正參數（不是真理）

下列常數**全部是待校正的先驗值**，要在 **P3 的 backtest** 用歷史賽果 + 收盤賠率擬合後才定案。先驗只是讓引擎能跑、能過 sanity test：

| 參數 | 意義 | 先驗 | 備註 |
|---|---|---|---|
| `BASE` | 基準進球率 | 1.35 | 國際賽單隊平均 |
| `GAMMA` | Elo→λ 強度 | 0.90 | 待擬合 |
| `HFA_ELO` | 地主主場優勢（Elo 點） | 100 | README 載明此 Elo 變體主場優勢約 +100；**僅 is_host_home 時施加** |
| `RHO` | Dixon–Coles 低分修正 | −0.10 | 小負數；過大會讓機率變負 |
| `MAXG` | score matrix 上界 | 10 | 足夠涵蓋 |

**免費校正錨點（P3 market backtest 之前就能用）**：README 給了此 Elo 變體的 win-expectancy 對照——**中立場** 100 分差 ≈ 64%、200 分 ≈ 76%、400 分 ≈ 91%。用來定 `GAMMA`/`BASE` 初值。

> ⚠️ **這是 win expectancy (We)，不是 `p_home`。** We 把平局算 0.5（≈ `p_home + 0.5·p_draw`），不是 1X2 主勝機率。足球平局多，100 分差時 `p_home` 會明顯**低於** 64%（一部分變成 draw）。校正時要讓 `We_model = p_home + 0.5·p_draw` 去逼近 64/76/91%，**別拿 `p_home` 直接對 64%**，否則 GAMMA 會被調太高。

### 5.1 Step A — Elo → 期望進球 λ（log-linear，永遠為正）

> **不要用加法式** `λ_away = (total − supremacy)/2`：強弱差大時 λ_away 會變負 → Poisson 爆掉。用 log-linear：

```python
def elo_to_lambdas(elo_home, elo_away, is_host_home):
    ha = HFA_ELO if is_host_home else 0.0          # 中立場 = 0
    d = (elo_home + ha - elo_away) / 400.0
    lam_home = BASE * math.exp(+GAMMA * d)
    lam_away = BASE * math.exp(-GAMMA * d)
    return lam_home, lam_away                       # 兩者恆 > 0
```
（此式隱含假設：兩隊 λ 乘積固定、總進球隨強弱差上升。簡化假設，P3 校正時可放寬。）

### 5.2 Step B — λ → score matrix → 機率

Dixon–Coles 低分相依修正 τ：

```python
def tau(i, j, lh, la, rho):
    if   i == 0 and j == 0: return 1.0 - lh * la * rho
    elif i == 0 and j == 1: return 1.0 + lh * rho
    elif i == 1 and j == 0: return 1.0 + la * rho
    elif i == 1 and j == 1: return 1.0 - rho
    else:                   return 1.0

def score_matrix(lh, la, rho=RHO, maxg=MAXG):
    P = [[0.0]*(maxg+1) for _ in range(maxg+1)]
    for i in range(maxg+1):
        for j in range(maxg+1):
            P[i][j] = poisson_pmf(i, lh) * poisson_pmf(j, la) * tau(i, j, lh, la, rho)
    s = sum(P[i][j] for i in range(maxg+1) for j in range(maxg+1))
    return [[P[i][j]/s for j in range(maxg+1)] for i in range(maxg+1)]  # 正規化
```

由 matrix 一次推導全部輸出：

```python
def derive(P, maxg=MAXG):
    rng = range(maxg+1)
    p_home = sum(P[i][j] for i in rng for j in rng if i > j)
    p_draw = sum(P[i][j] for i in rng for j in rng if i == j)
    p_away = sum(P[i][j] for i in rng for j in rng if i < j)
    p_o25  = sum(P[i][j] for i in rng for j in rng if i + j >= 3)   # 大小分 line=2.5
    p_btts = sum(P[i][j] for i in rng for j in rng if i >= 1 and j >= 1)
    return p_home, p_draw, p_away, p_o25, p_btts
```

`poisson_pmf` 用 `scipy.stats.poisson.pmf`。

### 5.3 Step C — 寫入

```python
lh, la = elo_to_lambdas(elo_home, elo_away, is_host_home)
P = score_matrix(lh, la)
p_home, p_draw, p_away, p_o25, p_btts = derive(P)
upsert match_predictions(
    match_id, model_version='dc-v1.0',
    lambda_home=lh, lambda_away=la,
    p_home=p_home, p_draw=p_draw, p_away=p_away,
    p_over_2_5=p_o25, p_btts=p_btts,
    exp_total_goals=lh + la,
)
```

### 5.4 Feature 1 的「爆冷」衍生（在 query / UI 層，非引擎）

引擎只輸出機率，**爆冷判定是可調規則**，建議定義（先驗閾值，可調）：

> 當 `|elo_home − elo_away| >= 150`（大眾預期一面倒），但弱隊的 `(p_win + p_draw) >= 0.40` 時 → 標「爆冷風險」。

不要硬編在引擎裡；放在前端或一個 view，閾值可調。

---

## 6. 驗收測試（PASS / FAIL，遵循專案 smoke-test 文化）

| ID | 測試 | 通過條件 |
|---|---|---|
| T0 | Elo ingest 資料品質 | filter 後 `teams` 恰 48 列、`team_id` 唯一、`elo` 無 null、`elo_asof <= today`（任一不符 → ETL 已 raise） |
| TF1 | fixtures 場次數 | `matches` 恰 104 列；`stage='group'` 72 列、knockout 32 列 |
| TF2 | 12 組 × 4 隊 | 每個 `group_label`(A–L) 恰 4 隊；每組打滿 6 場 group 賽 |
| TF3 | 隊名全解析 | fixtures 48 隊全部經 `team_aliases`（tla 或 name）對到 `team_id`；unmapped=0，否則 raise |
| TF4 | kickoff 窗口 | 所有 `kickoff_utc` ∈ [2026-06-11, 2026-07-19]；group 賽早於 knockout |
| TF5 | 跨來源抽查 | 抽 3–5 場對 native-stats / fifa.com，隊伍+日期一致（catch 抓到舊版 draw） |
| T1 | matrix 正規化 | 對多組 λ：`abs(sum(P) − 1) < 1e-9` |
| T2 | 機率非負 | 所有 `P[i][j] >= 0`（τ 在 RHO 過大時會產生負值 → 此測試攔截） |
| T3 | 1X2 加總 | `abs(p_home + p_draw + p_away − 1) < 1e-6` |
| T4 | 對稱性 | Elo 相等且非地主：`abs(lh − la) < 1e-9` 且 `abs(p_home − p_away) < 1e-6` |
| T5 | 強弱方向 | Elo 差大（如 +400）：`lh > la` 且 `p_home > 0.5 > p_away` |
| T6 | identity mapping | fixtures 中每隊都能解析；`unmapped_count == 0`，否則 ETL 應已 raise |
| T7 | sanity vs 已知榜 | 用 2026/01 Elo（西班牙最高），西班牙對弱隊 `p_home` 應明顯偏高 |
| T8 | host 開關 | 同兩隊、`is_host_home` 切 true/false，`lh` 應隨之上升/回落 |
| T9 | We 校正錨點 | 中立場、Elo 差 100/200/400 時，`We_model = p_home + 0.5·p_draw` 應分別 ≈ 0.64 / 0.76 / 0.91（容差 ±0.03）。**注意對的是 We 不是 p_home。** |

> **市場校正測試（T10, 延到 P3）**：接 Odds API 後，比對模型 1X2 vs Pinnacle 去 vig 機率，算 Brier / log-loss / calibration plot。**模型過不了校正，P3 的 value 判定就是放煙火。** 這是 go/no-go gate。

---

## 7. 設計風險清單（已在本 spec 處理，列出供 review）

1. **主場優勢只給地主三國**：`is_host_home` 開關，中立場預設 0。naive 套用會系統性偏誤。
2. **跨來源隊名映射**：`team_aliases` + fail-loud resolve。canonical key = eloratings `country_code`，**不 hardcode FIFA 三碼**。
3. **λ 用 log-linear 避免負值**：加法式有 Poisson 爆掉風險。
4. **Elo CSV 含 future-dated 年底欄位**：取每隊「不在未來」的最新快照，否則 `elo_asof` provenance 變假（數值對、日期錯）。
5. **校正參數是先驗非真理**：`BASE/GAMMA/HFA_ELO/RHO` 待 P3 擬合。HFA 先驗 100（README 值）。
6. **We ≠ p_home**：README 的 64/76/91% 是 win expectancy（含平局），校正 GAMMA 對 `We_model` 不對 `p_home`。
7. **市場效率**：引擎輸出在 UI 必須與市場賠率並列，不可單獨呈現為「正確答案」。
8. **CC BY-SA 授權**：Elo 資料要標 attribution。

---

## 8. 之後的 phase（不在本 spec）

- **P2** — Monte Carlo 群組模擬 → `group_sim`，套 tiebreaker（得失球差 → 進球數 → 對戰 → fair play → 抽籤），取各組前 2 + 8 個最佳第三名。**Feature 4**。
- **P3** — EV 計算機（純前端）+ 接 Odds API：去 vig、CLV、與 Pinnacle 共識比對（line-shopping）。**Feature 5** + 校正 gate。
- **P4** — 球員 anytime-goalscorer props（市場賠率，BALLDONTLIE）。**Feature 2**。
- **P5** — i18n（zh-TW）+ UI 收尾（無 chart lib，Tailwind 橫條 + 排序表即可）。
