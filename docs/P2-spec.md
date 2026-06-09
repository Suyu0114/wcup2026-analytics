# World Cup 2026 Analytics — P2 Spec v2

> Feature 4：Monte Carlo 群組賽模擬 → 晉級機率。
> 對齊 [P0-P1-spec.md](file:///c:/Users/jing8/Desktop/myProject/worldCup2026_analytics/docs/P0-P1-spec.md) / [P3-spec.md](file:///c:/Users/jing8/Desktop/myProject/worldCup2026_analytics/docs/P3-spec.md) / [CLAUDE.md](file:///c:/Users/jing8/Desktop/myProject/worldCup2026_analytics/CLAUDE.md)。
> 風格遵循專案原則：**verify-don't-assume**、**data integrity over approximation**、**fail-loud**、**idempotent**、**provenance**。
> v2：納入 review 的三個核心修正（score matrix 抽樣 / 已結算鎖定 / H2H 線性狀態機）。

---

## 0. Scope

**P2 = Feature 4（晉級機率）：Monte Carlo 模擬 72 場群組賽 → 每隊出線機率。**

核心交付：每隊 `P(晉級 R32)`、`P(小組第一)`、`P(小組第二)`、`P(最佳第三名)`，存入 `group_sim`。

依賴：P0（`teams` / `matches`）、P1（`match_predictions.lambda_home/away` + `engine.dixon_coles.score_matrix`）。

**明確不在 P2：**
- 淘汰賽 bracket 模擬（R32→決賽的「奪冠機率」）→ later extension
- outright winner 賠率比對（The Odds API `soccer_fifa_world_cup_winner`）→ P-extra
- UI 呈現（排序表 / 橫條）→ P5

---

## 1. Decisions locked

| # | Decision | 理由 |
|---|---|---|
| D1 | **Score matrix 多項式抽樣**（非 Poisson 直抽） | `data integrity over approximation`：P1 用 Dixon-Coles（含 ρ 修正），P2 必須用同一聯合分佈。Poisson 直抽是靜默近似，違反專案原則。 |
| D2 | **引擎重用 P1 的 λ** | 每場群組賽的 `lambda_home/away` 來自 `match_predictions`。模擬不重算 Elo→λ，provenance 一致。 |
| D3 | **v1 已結算場次鎖定** | `verify-don't-assume`：已知事實不能被機率覆蓋。`status='final'` 的場次用真實 `(home_goals, away_goals)`，不抽樣。 |
| D4 | **Tiebreaker = 線性狀態機**（零遞迴） | H2H 只做一次 pass，結果當附加 sort key。避免 3-way circular tie 導致的無限迴圈。 |
| D5 | **N = 10,000（預設）** | 標準誤 ≤ 0.5%，跑完 < 5 秒。可 CLI 參數覆蓋。 |
| D6 | **手動觸發** | `python -m etl.simulate`。v1 不接 cron 或串連 predict。 |
| D7 | **BT5 用 Elo 當 FIFA 排名 proxy** | 跨組第三名 tiebreaker 末尾，比 random 更有邏輯，且資料已在 DB。 |

---

## 2. Schema DDL

```sql
-- P2 (Feature 4: group-stage advancement simulation)
create table group_sim (
  team_id         text not null references teams(team_id),
  group_label     char(1) not null,               -- 'A'..'L'（denormalize，省 join）
  p_first         numeric not null,               -- P(小組第一)
  p_second        numeric not null,               -- P(小組第二)
  p_third_qual    numeric not null,               -- P(最佳第三名晉級)
  p_advance       numeric not null,               -- = p_first + p_second + p_third_qual
  sim_n           int not null,                    -- 模擬次數 N（provenance）
  model_version   text not null,                   -- = 'dc-v1.0'（對齊 match_predictions）
  computed_at     timestamptz not null default now(),
  primary key (team_id, model_version)
);
```

**設計決策：**
- PK = `(team_id, model_version)`：每次模擬 upsert 覆蓋（idempotent）。
- `p_advance` 冗餘（= 三項之和），但前端排序極常用。
- `group_label` 冗餘（`teams` 有），但 group-by 查詢幾乎一定需要，denormalize 避免 join。
- `sim_n` = provenance（這次跑了幾次）。

---

## 3. Tiebreaker 規則（FIFA 2026）

### 3.1 組內排名（4 隊 → 1st/2nd/3rd/4th）

**線性狀態機，零遞迴。** 兩段式排序（two-pass sort）：

```
Pass 1 (Overall)：按 (-pts, -gd, -gf) 排序 → 分出 tied groups
Pass 2 (H2H + fallback)：對每個 tied group (size ≥ 2):
    ① 從 match_results 中只取 subset 內部比賽 → 算 H2H pts/gd/gf
    ② 追加 sort key = (-h2h_pts, -h2h_gd, -h2h_gf, -elo, random_float)
    ③ 排完即最終名次（不遞迴）
```

| Sort Key 優先序 | 來源 | 層級 |
|---|---|---|
| `-pts` | 全組 6 場 | Pass 1 (overall) |
| `-gd` | 全組 6 場 | Pass 1 |
| `-gf` | 全組 6 場 | Pass 1 |
| `-h2h_pts` | tied subset 內部比賽 | Pass 2 (H2H) |
| `-h2h_gd` | tied subset 內部比賽 | Pass 2 |
| `-h2h_gf` | tied subset 內部比賽 | Pass 2 |
| `-elo` | teams.elo | Pass 2 (proxy for fair play / FIFA rank) |
| `random_float` | rng.random() | Pass 2 (lots) |

> [!NOTE]
> **為什麼零遞迴安全？**
>
> 3-way circular tie（A 勝 B、B 勝 C、C 勝 A，各 1-0）：
> - Overall: 三隊同 pts=6, gd=0, gf=2 → tied
> - H2H (Pass 2)：三隊之間各 1 勝 1 負 → h2h_pts=3, h2h_gd=0, h2h_gf=1 → 仍然全同
> - 自然 fallthrough 到 `-elo` → 再到 `random_float` → **必然**分出勝負
> - 沒有任何條件觸發「再算一次 H2H」，因為 H2H 是 sort key 的一部分，不是遞迴呼叫

> [!NOTE]
> **TB5（Fair play / 黃紅牌）在模擬中不可算。** 用 `-elo` 當 proxy，然後 `random_float` 當最終 lots。等價於合併 TB5+TB6。歷史上只有 2018 日本/塞內加爾一次用到 fair play，影響極微。

### 3.2 最佳第三名跨組排名（12 第三名 → 取 8 隊）

12 個第三名的排名規則（跨組比較，**無 H2H**——不同組沒交手）：

| 優先序 | Sort Key |
|---|---|
| BT1 | `-pts` |
| BT2 | `-gd` |
| BT3 | `-gf` |
| BT4 | `-elo`（FIFA 排名 proxy） |
| BT5 | `random_float` |

取前 8 名晉級 R32。

---

## 4. 引擎設計（`engine/group_sim.py`）

**純函數，無 I/O** ——完全離線可測（跟 [dixon_coles.py](file:///c:/Users/jing8/Desktop/myProject/worldCup2026_analytics/engine/dixon_coles.py) / [value.py](file:///c:/Users/jing8/Desktop/myProject/worldCup2026_analytics/engine/value.py) 一致風格）。

### 4.1 輸入

```python
@dataclass
class GroupMatch:
    match_id: str
    group_label: str          # 'A'..'L'
    home_team: str            # team_id
    away_team: str            # team_id
    lambda_home: float        # from match_predictions
    lambda_away: float
    is_settled: bool          # status == 'final'
    home_goals: int | None    # 真實比分（settled 時必有）
    away_goals: int | None

@dataclass
class SimConfig:
    n: int = 10_000
    seed: int | None = None   # reproducibility
```

### 4.2 Score Matrix 多項式抽樣（D1）

```python
from engine.dixon_coles import score_matrix, MAXG

def _build_flat_distribution(lh: float, la: float) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Score matrix → flat probability vector + corresponding (home_goals, away_goals) arrays.
    
    Returns:
        probs: shape (K,), K = (MAXG+1)², sums to 1.0
        home_g: shape (K,), integer home goals for each cell
        away_g: shape (K,), integer away goals for each cell
    """
    P = score_matrix(lh, la)                       # P1 的 Dixon-Coles（含 ρ 修正）
    K = (MAXG + 1) ** 2
    probs = np.empty(K)
    home_g = np.empty(K, dtype=int)
    away_g = np.empty(K, dtype=int)
    idx = 0
    for i in range(MAXG + 1):
        for j in range(MAXG + 1):
            probs[idx] = P[i][j]
            home_g[idx] = i
            away_g[idx] = j
            idx += 1
    return probs, home_g, away_g
```

抽樣：

```python
def _sample_score(probs, home_g, away_g, rng: np.random.Generator) -> tuple[int, int]:
    """From the joint distribution, sample one (home_goals, away_goals)."""
    idx = rng.choice(len(probs), p=probs)
    return int(home_g[idx]), int(away_g[idx])
```

> **效能優化**：72 場 × 10K 次 = 720K 次抽樣。每場的 `probs/home_g/away_g` 只算一次（cache），抽樣本身是 O(1)。vectorize 方式：每場先 `rng.choice(len(probs), size=N, p=probs)` 一次抽完 N 個 index，再 lookup，整體 < 2 秒。

### 4.3 已結算場次鎖定（D3）

```python
for match in group_matches:
    if match.is_settled:
        # ⚠️ verify-don't-assume: settled match 必須有比分
        assert match.home_goals is not None and match.away_goals is not None
        # 所有 N 次模擬都用同一比分（不抽樣）
        home_scores[match_idx, :] = match.home_goals
        away_scores[match_idx, :] = match.away_goals
    else:
        # 從 score matrix 聯合分佈抽
        indices = rng.choice(K, size=N, p=probs[match_idx])
        home_scores[match_idx, :] = home_g_lookup[match_idx][indices]
        away_scores[match_idx, :] = away_g_lookup[match_idx][indices]
```

### 4.4 Tiebreaker 實作（D4 — 線性狀態機）

#### 資料結構

```python
@dataclass
class TeamStanding:
    team_id: str
    elo: float                # for fallback sort
    pts: int = 0
    gf: int = 0               # goals for
    ga: int = 0               # goals against
    
    @property
    def gd(self) -> int:
        return self.gf - self.ga

# 對戰結果表：key = frozenset 無序隊伍對
# 一組 4 隊 = 6 pairs，每 pair 存雙方進球
MatchResult = tuple[int, int]   # (team_a_goals, team_b_goals)
h2h_results: dict[frozenset[str], MatchResult]
```

#### 排序函數（核心）

```python
def rank_group(
    standings: list[TeamStanding],
    h2h_results: dict[frozenset, MatchResult],
    rng: np.random.Generator,
) -> list[str]:
    """Return team_ids sorted 1st→4th. Two-pass, zero recursion.
    
    Pass 1: overall (-pts, -gd, -gf)
    Pass 2: within tied subsets → H2H (-h2h_pts, -h2h_gd, -h2h_gf, -elo, random)
    """
    # Pass 1: group by identical (pts, gd, gf)
    key_fn = lambda s: (-s.pts, -s.gd, -s.gf)
    sorted_overall = sorted(standings, key=key_fn)
    
    # Identify tied groups
    result: list[str] = []
    i = 0
    while i < len(sorted_overall):
        j = i + 1
        while j < len(sorted_overall) and key_fn(sorted_overall[j]) == key_fn(sorted_overall[i]):
            j += 1
        tied = sorted_overall[i:j]
        
        if len(tied) == 1:
            result.append(tied[0].team_id)
        else:
            # Pass 2: H2H within this tied subset
            subset_ids = {s.team_id for s in tied}
            h2h_stats = _compute_h2h_stats(tied, h2h_results, subset_ids)
            
            # Final sort: H2H → Elo → random (single pass, no recursion)
            random_tiebreak = {s.team_id: rng.random() for s in tied}
            resolved = sorted(tied, key=lambda s: (
                -h2h_stats[s.team_id][0],    # h2h_pts
                -h2h_stats[s.team_id][1],    # h2h_gd
                -h2h_stats[s.team_id][2],    # h2h_gf
                -s.elo,                       # FIFA rank proxy
                random_tiebreak[s.team_id],   # lots
            ))
            result.extend(s.team_id for s in resolved)
        
        i = j
    return result


def _compute_h2h_stats(
    tied: list[TeamStanding],
    h2h_results: dict[frozenset, MatchResult],
    subset_ids: set[str],
) -> dict[str, tuple[int, int, int]]:
    """Compute H2H pts/gd/gf for a subset of tied teams. Single pass, no recursion.
    
    Returns: {team_id: (h2h_pts, h2h_gd, h2h_gf)}
    """
    stats = {s.team_id: [0, 0, 0] for s in tied}   # [pts, gd, gf]
    
    for s in tied:
        for other in tied:
            if s.team_id >= other.team_id:
                continue
            pair = frozenset({s.team_id, other.team_id})
            if pair not in h2h_results:
                continue                            # shouldn't happen in group stage
            a_goals, b_goals = h2h_results[pair]
            # Determine which team is 'a' (alphabetically first in frozenset iteration)
            teams_sorted = sorted(pair)
            if s.team_id == teams_sorted[0]:
                sg, og = a_goals, b_goals
            else:
                sg, og = b_goals, a_goals
            
            # Points
            if sg > og:
                stats[s.team_id][0] += 3
            elif sg == og:
                stats[s.team_id][0] += 1
                stats[other.team_id][0] += 1
            else:
                stats[other.team_id][0] += 3
            
            # GD, GF
            stats[s.team_id][1] += sg - og
            stats[other.team_id][1] += og - sg
            stats[s.team_id][2] += sg
            stats[other.team_id][2] += og
    
    return {tid: tuple(v) for tid, v in stats.items()}
```

> [!IMPORTANT]
> **`_compute_h2h_stats` 是純查表函數**，不呼叫自身、不呼叫 `rank_group`、不觸發任何排序。它只從 `h2h_results` dict 中篩選出 subset 內部的比賽，加總 pts/gd/gf，回傳。沒有任何遞迴路徑。

#### 最佳第三名排序

```python
def rank_third_places(
    thirds: list[TeamStanding],
    rng: np.random.Generator,
) -> list[str]:
    """Rank 12 third-place teams, return top 8 team_ids.
    No H2H (cross-group teams haven't played). Sort: -pts, -gd, -gf, -elo, random.
    """
    random_tb = {s.team_id: rng.random() for s in thirds}
    ranked = sorted(thirds, key=lambda s: (-s.pts, -s.gd, -s.gf, -s.elo, random_tb[s.team_id]))
    return [s.team_id for s in ranked[:8]]
```

### 4.5 主模擬迴圈

```python
def simulate_groups(
    matches: list[GroupMatch],
    team_elos: dict[str, float],
    config: SimConfig,
) -> list[TeamSimResult]:
    """Run N Monte Carlo simulations of the group stage.
    
    Returns 48 TeamSimResults (one per team).
    """
    rng = np.random.default_rng(config.seed)
    
    # Pre-compute: for each unsettled match, build flat distribution (once)
    distributions = {}
    for m in matches:
        if not m.is_settled:
            distributions[m.match_id] = _build_flat_distribution(m.lambda_home, m.lambda_away)
    
    # Counters
    counts = {team_id: {"first": 0, "second": 0, "third_qual": 0} for ...}
    
    for sim_i in range(config.n):
        # 1. Generate all 72 match results
        results = {}
        for m in matches:
            if m.is_settled:
                hg, ag = m.home_goals, m.away_goals
            else:
                probs, hg_arr, ag_arr = distributions[m.match_id]
                hg, ag = _sample_score(probs, hg_arr, ag_arr, rng)
            results[m.match_id] = (m.home_team, m.away_team, hg, ag)
        
        # 2. Build standings + H2H for each group
        group_rankings = {}
        third_place_standings = []
        for group in 'A'..'L':
            standings, h2h = _build_group_standings(group, matches, results, team_elos)
            ranking = rank_group(standings, h2h, rng)
            group_rankings[group] = ranking
            
            counts[ranking[0]]["first"] += 1
            counts[ranking[1]]["second"] += 1
            # ranking[2] = 3rd place (might qualify)
            third_place_standings.append(standings_of(ranking[2]))
        
        # 3. Best third places
        qualified_thirds = rank_third_places(third_place_standings, rng)
        for tid in qualified_thirds:
            counts[tid]["third_qual"] += 1
    
    # 4. Convert counts → probabilities
    return [
        TeamSimResult(
            team_id=tid,
            p_first=c["first"] / config.n,
            p_second=c["second"] / config.n,
            p_third_qual=c["third_qual"] / config.n,
            p_advance=(c["first"] + c["second"] + c["third_qual"]) / config.n,
            sim_n=config.n,
            model_version=MODEL_VERSION,
        )
        for tid, c in counts.items()
    ]
```

### 4.6 效能估算

| 步驟 | 成本 | 備註 |
|---|---|---|
| Score matrix 預算（72 場 × 1 次） | < 0.1 秒 | 只算未結算場次 |
| 抽樣（≤72 場 × 10K 次） | < 1.5 秒 | vectorized `rng.choice(K, size=N, p=probs)` |
| Tiebreaker（12 組 × 10K 次） | < 2 秒 | 每次排 4 元素 + H2H 查表 |
| 最佳第三名（10K 次 × 排 12 元素） | < 0.5 秒 | 純排序 |
| **總計** | **< 5 秒** | N=10K |

---

## 5. ETL 契約（P2）

### 5.1 `etl/simulate.py`

```
python -m etl.simulate              # simulate + write to Supabase
python -m etl.simulate --dry-run    # simulate + summarize, no DB
python -m etl.simulate --n 50000    # override simulation count
python -m etl.simulate --seed 42    # deterministic (for tests / debugging)
```

```python
def run(dry_run=False, n=10_000, seed=None):
    # 1. Read group-stage matches + lambdas + actual scores (settled)
    matches = db.fetch_group_matches_with_predictions()
    # Validation:
    #   - 72 group matches
    #   - 12 groups × 4 teams
    #   - every match has lambda_home/away (joined from match_predictions)
    #   - settled matches have home_goals/away_goals (fail-loud if None)
    
    team_elos = db.fetch_team_elos()
    
    # 2. Run simulation (engine, pure function, no I/O)
    config = SimConfig(n=n, seed=seed)
    results = simulate_groups(matches, team_elos, config)
    # assert 48 results
    
    # 3. Print summary
    for r in sorted(results, key=lambda x: -x.p_advance)[:10]:
        print(f"  {r.team_id}: advance={r.p_advance:.1%}")
    
    # 4. Write
    if not dry_run:
        db.upsert_group_sim(results)
```

### 5.2 新增 `db.py` 函數

```python
def fetch_group_matches_with_predictions(model_version: str = "dc-v1.0") -> list[dict]:
    """Join matches (stage='group') with match_predictions to get lambda_home/away.
    Also includes status, home_goals, away_goals for settled match locking.
    
    Validation: 72 matches, all have lambda_home/away.
    Settled matches (status='final') must have non-null goals.
    """
    # matches LEFT JOIN match_predictions ON (match_id, model_version)
    # WHERE stage = 'group'
    ...

def upsert_group_sim(rows: list[dict]) -> int:
    """Upsert to group_sim on_conflict=(team_id, model_version). Idempotent."""
    ...
```

---

## 6. 驗收測試（PASS / FAIL）

| ID | 測試 | 通過條件 |
|---|---|---|
| **TS1** | 機率正規化（組內） | 每組 4 隊的 `p_first` 加總 ≈ 1.0（容差 ±1/N）；`p_second` 同理 |
| **TS2** | 48 隊全有結果 | `group_sim` 恰 48 列；12 組各 4 隊 |
| **TS3** | 確定性（seed） | 同 seed + 同 N → 完全相同結果；不同 seed → 不同結果 |
| **TS4** | 強隊方向 | Elo 顯著高的隊伍 `p_advance` > 同組 Elo 低的隊伍（抽 3-5 組驗證） |
| **TS5** | 等強對稱 | 全隊 Elo 相同 → `p_first ≈ 0.25`、`p_advance ≈ 2/3`（±寬容差，因 best-3rd 不完全對稱） |
| **TS6** | Tiebreaker GD | 手工構造 2 隊同 pts 不同 gd → gd 高的排前面 |
| **TS7** | Tiebreaker H2H | 手工構造 2 隊同 pts/gd/gf → H2H 勝者排前面 |
| **TS8** | 3-way circular tie | A>B>C>A 各 1-0 → 不 crash、不無限迴圈、不 RecursionError |
| **TS9** | 最佳第三名 | 每次模擬恰 24+8=32 隊晉級（不多不少） |
| **TS10** | 已結算鎖定 | mock 一場 `is_settled=True, home_goals=2, away_goals=0` → 所有 N 次模擬該場均為 2-0 |
| **TS11** | Score matrix 一致性 | 對同一 λ，抽樣 N=100K 次的 (i,j) 頻率 vs `score_matrix(λh, λa)[i][j]` 的卡方檢驗 p > 0.01 |
| **TS12** | 效能 | N=10,000 跑完 < 10 秒（寬鬆上界） |

> 離線（不需 Supabase）：TS1/TS3-TS12 用 mock 資料。
> 整合：TS2 需 DB。

---

## 7. 設計風險清單

1. **Score matrix 多項式抽樣 vs Poisson 直抽**：D1 裁決用 score matrix。跟 P1 provenance 一致。未來 P3 校正 ρ → P2 自動繼承（重跑 predict → 重跑 simulate 即可）。
2. **Fair play tiebreaker 不可模擬**：用 `-elo` 當 proxy，再 `random_float` 當 lots。合併 TB5+TB6。影響極微。
3. **最佳第三名跨組機制**：48 隊 / 12 組的「8 個最佳第三名」是 2026 新格式，無歷史先例。邏輯按 FIFA 公佈規則。
4. **H2H 線性狀態機**：零遞迴，`_compute_h2h_stats` 是純查表。3-way circular tie → fallthrough 到 elo → random。
5. **λ provenance 鏈**：`Elo CSV → teams.elo → match_predictions.lambda → group_sim.p_advance`。校正參數改了需按序重跑：`predict → simulate`。
6. **已結算場次鎖定的 fail-loud**：`is_settled=True` 但 `home_goals is None` → `assert` 直接 raise。不靜默。

---

## 8. 結構（新增 / 修改的檔案）

```
engine/group_sim.py         [NEW]   — 純函數模擬引擎（score matrix 抽樣 + tiebreaker 狀態機 + 主迴圈）
etl/simulate.py             [NEW]   — ETL job（讀 DB → 引擎 → 寫 DB）
etl/db.py                   [MODIFY] — 新增 fetch_group_matches_with_predictions() / upsert_group_sim()
etl/sql/schema.sql          [MODIFY] — 新增 group_sim 表
tests/test_group_sim.py     [NEW]   — TS1–TS12（離線）
docs/P2-spec.md             [NEW]   — 本文件（review 通過後從 artifact 搬入）
CLAUDE.md                   [MODIFY] — 更新現況（加 P2）、新增指令 `python -m etl.simulate`
```

---

## 9. 裁決紀錄（v1 review 的三個修正）

| 原 Issue | 問題 | 裁決 | 併入 |
|---|---|---|---|
| Decision 3 (v1) | Poisson 直抽 = 靜默近似，違反 `data integrity over approximation` | **改 score matrix 多項式抽樣**（D1） | §4.2 |
| Decision 7 (v1) | v1 不鎖已結算 → `verify-don't-assume` 違反；賽中顯示已淘汰隊有機率 | **v1 做已結算鎖定**（D3） | §4.3 |
| H2H 遞迴 (v1) | 3-way circular tie → 遞迴回自身 → RecursionError | **線性狀態機，零遞迴**（D4） | §4.4 |

---

P2 spec v2 定案待 review。
