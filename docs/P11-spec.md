# P11 — 小組賽晉級情境分析（Qualification Scenario Analysis）

> Feature：吃「實際積分榜（只 final）+ 剩餘小組賽程」，對每場**尚未終場**的小組賽，算出
> W/D/L 三種結果分別把參賽兩隊的晉級狀態變成什麼；並標記 **convenience draw**（平手即可
> 讓雙方都晉級）與 **dead rubber**（無關痛癢場）。
> 對齊 [P2-spec.md](P2-spec.md)（模擬/晉級規則）、[P8-spec.md](P8-spec.md)（積分榜＝事實）、[CLAUDE.md](../CLAUDE.md)。
> **狀態：review 已裁決、定案（見 §14 裁決紀錄），進 Phase 2 實作。**
> 風格遵循專案原則：**verify-don't-assume**、**data integrity over approximation**、**fail-loud**、**idempotent**、**provenance**、**事實/模型分離**。
>
> **裁決摘要（§14）**：v1-lean（跨組第三名僅 conditional + 可選機率）+ 新表 `group_scenarios` + 獨立
> `/scenarios` 頁（按組編排：mini 積分榜 context + 情境卡）+ 分離式機率小字。另修兩個設計問題：
> **[A]** `dead_rubber` 過度宣稱 → 新增 `seeding_live` facet、重定義 dead_rubber；
> **[B]** `convenience_draw` 的 GD-only false-negative 明列為刻意行為。

---

## 0. Scope

**做：** 一個 **決定性（事實）** 的「若 A 則 B」晉級情境引擎 + 落表 + 前端呈現。
針對每一場 `stage='group'` 且 `status!='final'` 的比賽，輸出：

- 該場 **home-win / draw / away-win** 三種結果下，**兩隊各自**的晉級狀態分類。
- 每場的 `convenience_draw` / `dead_rubber` 旗標。

**最有意義的時點是 MD2、MD3**（剩餘排列少、開始出現 clinch/eliminate）；但引擎**對任何非終場小組賽通用**（MD1 多半全 `alive`，前端 graceful 呈現「言之過早」即可，引擎不特判輪次）。

**明確不在 P11：**
- 改任何模型 / 預測 / 賠率 / value 算術（這是**事實**，比照 P8：無 `model_version`、不經校正）。
- 淘汰賽對戰圖 / bracket 情境（賽前 TBD，trap #10）→ later。
- 「奪冠機率」「晉級機率」**數值**＝既有 `group_sim`（模型）。本功能**可選擇性**引用其機率作為**清楚分離**的覆蓋層，但**絕不**把機率當成事實情境的一部分（§7）。

---

## 1. 與 P2 / P8 的關係 + 重用地圖（**不重寫晉級判定**）

CLAUDE.md 多次警告「兩條 code path 會分岔」。本功能的晉級數學**一律重用既有單一來源**：

| 需要的數學 | 重用既有 | 不可做什麼 |
|---|---|---|
| 組內 4 隊排名（已知結果） | `engine/standings.py::compute_group_standings`（決定性、含 `tied`、**無 Elo/random**） | 不重寫 Pts→GD→GF→H2H 排序 |
| H2H pts/gd/gf | `engine/group_sim.py::_compute_h2h_stats`（兩處已共用） | 不另寫一份 H2H 累加 |
| 最佳第三名選取（需機率時） | `engine/group_sim.py::rank_third_places` / `group_sim` 表 | 不另寫一份「取前 8」邏輯 |
| 已結算鎖定 | 比照 `group_sim` D3 / `standings` 的 `status='final'` 過濾 | 不把已終場場次當變數 |

> [!IMPORTANT]
> **為什麼情境引擎不能直接呼叫 `group_sim.rank_group` 或 `rank_third_places` 來「定名次」？**
> 兩者尾段是 `…→Elo→random`——那是**蒙地卡羅為了強制全序**的裝置，**不是真實 FIFA tiebreaker**。
> 拿來當「事實情境」會謊報（Elo 不是規則）。P8 正是為此刻意把顯示排名 `engine/standings.py`
> 與 `group_sim.rank_group` 分叉。**本功能站在 P8 那一側**：事實層只走到 `Pts→GD→GF→H2H`，
> 再下去（fair play / 抽籤）對我們而言是「未定」，**誠實標 ambiguous，不用 Elo/random 補**。
> 真正需要全序機率時 → 走 §7 的 `group_sim` 覆蓋層（模型，清楚分離）。

---

## 2. 晉級規則（2026 賽制，重述）

- 12 組（A–L）各 4 隊，每組打 6 場（MD1/MD2/MD3 各 2 場）。
- **每組前 2 名（24 隊）+ 跨組 8 個最佳第三名 = 32 隊**晉級 R32。
- 組內 tiebreaker：Pts → GD → GF → H2H(pts,gd,gf) → fair play → 抽籤。**fair play/抽籤不可算 → 視為未定**。
- 跨組第三名 tiebreaker（無 H2H，不同組未交手）：Pts → GD → GF → fair play → 抽籤。

由此得到**組內名次 → 晉級**的對應：
- **第 1、2 名**：必晉級（**與跨組無關**）。
- **第 3 名**：**可能**晉級（取決於 12 個第三名跨組比較，取前 8）。
- **第 4 名**：必淘汰。

---

## 3. 核心正確性陷阱 + 誠實契約（本功能的靈魂）

### 3.1 兩個「看不到的未來」

1. **組內名次取決於 GD/GF，而 GD/GF 取決於剩餘比賽的實際比分**（不只 W/D/L）。
   「贏」可能是 1:0 或 5:0，會改變 GD。
2. **跨組第三名取決於別組的第三名 GD**——那些比賽你看不到、也還沒打完（user 點 3）。

### 3.2 誠實契約（硬性，違反即等於謊報）

> [!IMPORTANT]
> **唯有「在所有未定結果下都成立」或「相關比賽皆已 final」時，才標 `CLINCHED` / `ELIMINATED`；
> 否則一律 `alive`（conditional）並寫清依據。GD 對外組未定時，絕不謊稱『平手就夠』。**

落實成兩個 sound（永不過度宣稱）的近似：

- **組內以「分數帶（points-band）」推理，GD 未定即視為 ambiguous。**
  對某一 W/D/L 完成情形（completion），各隊**積分**已知；**積分相同的隊伍**之間，名次取決於
  尚未踢出的 GD/GF/H2H → **整段視為可換位（band 內每個名次都可能）**。
  這是 **over-approximation**：只會「多算可能名次」→ 只會讓 clinch **少報**，**永不誤報**（§5.2 證明）。
- **跨組第三名：在 points-band 抽象下幾乎永遠無法決定性 clinch**（GD 跨組亂跳）。
  → 第三名去留**預設標 `alive`（needs_best_third）**，要呈現可能性就走 §7 機率覆蓋層（模型，分離）。

> [!NOTE]
> **由此推出的誠實數學結論（直接回應 user 點 3）：**
> 在所有小組賽踢完前，「靠第三名晉級」**本質上幾乎不可能是決定性事實**（別組 GD 一動就翻盤）。
> 所以 v1 對「第三名能否晉級」**誠實地只給 conditional + 可選機率**，不發 `advance_clinched(via 3rd)`
> 的事實標章。`top2_clinched`（前二）與 `eliminated`（必為第 4）**才是**能在賽前下的事實。
> 這不是功能縮水，正是 user 要的「不謊稱夠」。更激進的決定性第三名 clinch → §6 follow-up（已裁決：v1 不做）。

### 3.3 刻意的 false-negative（[B]，已裁決，**非 bug**）

> [!IMPORTANT]
> **`convenience_draw` 強義建立在 points-band 的 `top2_clinched` 上（§4），因此「只靠 GD 才鎖前二」的
> convenience draw 會被保守漏標（false-negative-by-design）。** 例：A、B 平手後與第三隊 C 同積分，
> 實際上 A、B 的 GD 足以壓過 C、平手即雙雙晉級，但 points-band 看到三隊同分 → A、B band 含第 3 名
> → 不發 `top2_clinched` → `convenience_draw=false`。
> 此方向與 §3.2 / §5.2 的 sound 取捨**一致**（永不誤報、可少報），是**刻意**行為，日後勿誤判為 bug。
> 驗收 SC14 專門鎖這條（記錄為 false-negative-by-design）。同理任何「靠 GD 的 clinch」一律保守標 `alive`。

---

## 4. 狀態分類（per team，per match-outcome）

對「比賽 M，結果 O ∈ {home,draw,away}」下的某一隊 T，跑遍**該組其他未定比賽**的所有 W/D/L
完成情形，取 T 的**可能名次集合**（possible-rank set），分類：

| `status` | 定義（在 M=O 下，跨所有 completion） | 性質 |
|---|---|---|
| `top2_clinched` | 可能名次恆 ⊆ {1,2} | **事實**：必晉級（與跨組無關） |
| `eliminated` | 可能名次恆 = {4} | **事實**：必淘汰 |
| `advance_clinched` | 必晉級且需動用跨組第三名才成立（**僅當跨組已可決定性證明**——見 §6；v1 預設**不發**） | 事實（稀有/賽末） |
| `alive` | 其餘（仍存活、有條件） | conditional |

附帶 **facet 布林**（豐富 `alive`、供前端文案）：

- `can_win_group`：某 completion 下名次可為 1（possible-rank 含 1）。
- `secured_3rd_or_better`：可能名次恆 ⊆ {1,2,3}（組內不可能墊底，但晉級仍看跨組）。
- `needs_best_third`：非 clinch/elim，且某 completion 名次可為 3 → 去留押在跨組第三名戰。
- `seeding_live`（[A]）：**已 `top2_clinched`，但最終組內名次（1 vs 2）尚未定**（possible-rank = {1,2}）
  → 仍有種子位/R32 對手要爭。`top2_clinched` 且名次已釘死（{1} 或 {2}）→ `false`。

**match-level 旗標**（由上述 per-team 結果決定性推導，§8 說明存哪）：

- `convenience_draw`（強義，Gijón 型）：`draw` 結果下**兩隊皆 `top2_clinched`** → 平手雙方都鎖前二。
  - ⚠️ 建在 `top2_clinched` 上 → 有刻意的 GD-only false-negative（§3.3）。
- `convenience_draw_kind`：
  - `top2`：上面強義成立（`convenience_draw=true`，事實）。
  - `mutual_3rd_conditional`：`draw` 下兩隊皆 `secured_3rd_or_better` 但至少一隊 `needs_best_third`
    → 「平手雙方都至少第三、晉級仍看別組」（**`convenience_draw=false`**，僅作清楚標示的較弱 conditional 訊號）。
- `dead_rubber`（[A] 已修正，**收窄**）：對**兩隊**而言，三種結果 (W/D/L) 下 `status` 皆相同且為終局
  （`top2_clinched` 或 `eliminated`）**且任一結果皆非 `seeding_live`** → 此場**與晉級與名次皆無關**（真正無球可爭）。
  - **「雙方已晉級但名次/GD 仍動種子位」≠ dead rubber**：仍影響 R32 對手/籤位 → `dead_rubber=false`、`seeding_live=true`。
  - 文案精確化：dead rubber 標「**與晉級無關**」而非「無關痛癢」；其下若 `seeding_live` 另標「仍爭名次/種子」。

---

## 5. 引擎設計 — `engine/scenarios.py`（純函數，無 I/O）

風格同 `group_sim.py` / `standings.py`（離線可測）。

### 5.1 輸入 / 輸出 dataclass

```python
@dataclass
class ScenarioMatch:
    match_id: str
    group_label: str          # 'A'..'L'
    home_team: str            # team_id（兩碼，trap #1）
    away_team: str
    status: str               # 'final' | 其他
    home_goals: int | None    # final 必有（fail-loud）
    away_goals: int | None

@dataclass
class TeamOutcome:
    team_id: str
    status: str               # top2_clinched | advance_clinched | eliminated | alive
    can_win_group: bool
    secured_3rd_or_better: bool
    needs_best_third: bool
    seeding_live: bool        # [A] 已鎖前二但 1 vs 2 未定（still scope for seeding）
    basis_key: str            # 結構化 i18n key（前端翻譯，不存句子；見 §8）

@dataclass
class MatchScenario:
    match_id: str
    group_label: str
    home_team: str
    away_team: str
    outcomes: dict[str, tuple[TeamOutcome, TeamOutcome]]  # 'home'/'draw'/'away' → (home_team, away_team)
    convenience_draw: bool
    convenience_draw_kind: str | None   # 'top2' | 'mutual_3rd_conditional' | None
    dead_rubber: bool
```

主函數（每組獨立）：

```python
def analyze_group(
    group_label: str,
    matches: list[ScenarioMatch],     # 該組全部 6 場（含 final 與未定）
) -> list[MatchScenario]:
    """對該組每一場 status!='final' 的比賽，產生 W/D/L × 兩隊的晉級狀態。
    fail-loud：該組必為 4 隊；final 場必有 goals。"""
```

### 5.2 組內 points-band 演算法（sound 的核心）

固定「M=O」後，列舉該組**其他未定比賽**的 W/D/L（每場 3 種；剩餘 k 場 → 3^k，
MD2 最多 27、MD3 為 3，極小）。對每個 completion：

1. 各隊**積分** = 已 final 場積分（鎖定）+ 本 completion 假設 W/D/L 的積分。
2. 依積分降序；**積分相同者結成一個 band**。設某隊上方有 `a` 隊積分嚴格較高、與其同分（含自己）共 `e` 隊
   → 該隊 **possible-rank band = [a+1, a+e]**（band 內每個名次都可能；GD/GF/H2H/抽籤未定）。
3. 累積每隊跨所有 completion 的**可能名次集合**（union of bands）。

分類（令 band 上界 `hi = a+e`、下界 `lo = a+1`；跨 completion 取 `min_rank=min lo`、`max_rank=max hi`）：
- `top2_clinched` ⇔ **每個** completion 都 `hi ≤ 2`（`max_rank ≤ 2`）。
  - 含 `a=0,e=2`（兩隊並列首 → band{1,2}）→ 雙方都鎖前二＝convenience draw 的數學根據。
- `eliminated` ⇔ 每個 completion 都 `lo=4`（恰 3 隊在上、自己單獨墊底 → band{4}）。
- `secured_3rd_or_better` ⇔ 每個 completion 都 `hi ≤ 3`。
- `can_win_group` ⇔ `min_rank = 1`。
- `needs_best_third` ⇔ 非 clinch/elim，且某 completion band 含 3。
- `seeding_live`（[A]）⇔ `top2_clinched` 且 `min_rank ≠ max_rank`（= {1,2}，名次未釘）。
- 其餘 → `alive`。

**match-level（跨三 outcome 聚合，只看本場兩隊）：**
- `convenience_draw` ⇔ `draw` 下兩隊皆 `top2_clinched`（`kind='top2'`）。
- `convenience_draw_kind='mutual_3rd_conditional'`（`convenience_draw=false`）⇔ `draw` 下兩隊皆
  `secured_3rd_or_better` 且至少一隊 `needs_best_third`。
- `dead_rubber` ⇔ 對兩隊：三 outcome 的 `status` 皆相同且 ∈ {`top2_clinched`,`eliminated`}，**且**三 outcome
  皆 `seeding_live=false`（[A]：名次也釘死才算真死）。

> [!NOTE]
> **設計取捨（誠實 > 精確，已知刻意）：** band 內一律視為可換位，**不**用「GD 極值推理」去
> 進一步分割（例如「只要不輸 3 球就壓過對手」）。代價：**靠 GD 才成立的 clinch 會被低報為
> `alive`**（保守）。好處：**永不誤報 clinch/eliminate**。GD 極值細算列為 §6 的 v2 選項。

### 5.3 為什麼 sound（永不誤報）

band 是「真實可能名次」的**超集**（真實 tiebreaker 只會在 band 內挑一個確定位置；我們宣告整段都可能）：
- 宣告 `top2_clinched` 需「**每個** completion 名次都 ⊆{1,2}」；既然 band ⊇ 真實名次，
  band⊆{1,2} ⇒ 真實名次⊆{1,2}。**故 clinch 為真**（不誤報）。
- `eliminated` 同理（band={4} ⇒ 真實=4）。
- 代價只發生在「真實會 clinch，但 band 因加進不可能名次而沒 clinch」→ **少報**，可接受。

### 5.4 重用點（落實 §1）
- final 場：以真實比分餵 `compute_group_standings` 不是必要（band 只需積分）；但**呈現「目前實際積分榜」**
  時直接讀 `group_standings`（P8），不重算。
- 當某 completion 需要真正定序（例如未來 §6 v2 的 GD 極值、或 §7 機率）→ 一律走既有
  `compute_group_standings` / `group_sim`，不另寫 tiebreaker。

---

## 6. 跨組第三名：v1-lean（**已裁決採用**）+ follow-up

§3.2 已論證：在 points-band 抽象下，賽前幾乎無法決定性 clinch/eliminate「靠第三名」的隊伍。

**裁決（§14.1）：v1 採 v1-lean，不做 v1-full。**

- **v1-lean（採用）**：跨組第三名**不做**決定性判定。組內 `secured_3rd_or_better` 但
  `needs_best_third` 的隊 → 狀態 `alive`，`basis_key` 標「至少第三，晉級看跨組最佳第三名」。
  要看可能性 → §7 機率覆蓋層（模型，分離）。最簡、最誠實、可立即上線。
### 6.1 Deferral 理由（已修正，勿誤記為「永遠用不到」）

v1-full 的真實價值**集中在「MD3 末班車窗口」**：賽程有時差，**後踢的組做決定時，多數別組第三名線
已 `final`**——此時「靠第三名是否安全」確實可能成為事實。所以 v1-full **不是永遠用不到**，只是 v1 先不做。

### 6.2 follow-up（若要做，只做簡化版）

**僅在「其他所有組皆 `final`」時才啟用決定性第三名 clinch/eliminate。** 此時別組 11 個第三名線**已知固定**，
**不需列舉別組剩餘賽程**（複雜度遠低於 §6 草案的 GD 極值一般版）：

- 別組 11 個第三名線已知；本組 G 的第三名線在某 completion 下由本組 points/GD 決定（只需對 **本組** 做 GD 極值，單組、極小）。
- T（本組第三）晉級 ⟺ 12 個第三名中名列前 8 ⟺ 11 個已知線中至多 7 個排在 T 之上。
  - **SAFE（發 `advance_clinched`）**：用 T 的**最差**可能第三名線，仍排前 8。
  - **DEAD（升級 `eliminated`）**：用 T 的**最佳**可能第三名線，仍落在第 9 之後。
- 比較鍵 **Pts→GD→GF**，相等＝抽籤未定（SAFE 測試把同分算「可能在上」保守；DEAD 測試不算保守）。
- **反 fork**：跨組比較鍵抽成共用 helper，供 `group_sim.rank_third_places` 與此處共用；**不**複製「取前 8」。

> follow-up 觸發條件嚴格（其他 11 組全 final）→ 程式小、正確性面積可控；待賽末真有需求再評估。

---

## 7. 事實 vs 模型分離（硬性，trap #7 / #13b）

- §4/§5 的 `status`、`convenience_draw`、`dead_rubber` 全是**決定性事實**：無 `model_version`、不經校正、不碰 Elo/random。
- **已裁決放入（§14.4）**：對 `alive` / `needs_best_third` / `mutual_3rd_conditional` 的隊，前端**附**
  `group_sim` 的 `p_advance` / `p_third_qual` 機率小字——但**嚴格分離**：
  1. 必須**明確標示為「模型・實驗性」**、與事實狀態**視覺/資料分離**，不可混算成「事實的一部分」。
  2. 機率受 `ModelVersionSwitcher`（P10 `?v=`）影響；事實情境**不受版本影響**（同一份事實，不帶 `model_version`）。
  3. 機率缺（表未跑/空）→ 只顯示事實，graceful（trap #13d）。
- **Guardrail（§14.4，硬性）**：機率措辭**絕不可讀起來像把 `alive` 升級成 clinch**。**禁止**「99% 已晉級」「幾乎晉級」
  這類把 conditional 講成既定事實的字樣；只用中性的「模型估晉級機率 X%（實驗性）」。狀態徽章（事實）與機率小字（模型）
  在版面上必須可一眼區分。
- **澄清（§14.4）**：hard rule #7「模型須與市場並列」**不適用於此處**——第三名晉級**無對應市場盤**、無 parity 義務；
  本功能只需守 trap #13b 的**事實/模型分離**（不需把機率與某個市場去 vig 並列）。
- 引擎 `engine/scenarios.py` **不 import** `group_sim` 的機率產物（事實層純淨）；機率覆蓋層在前端 `data.ts`/component 端組裝，
  只（在 §6.2 follow-up 時）共用 `group_sim` 的**選取鍵**純函數。

---

## 8. 後端形態：新 ETL 表 `group_scenarios`（**已裁決，§14.2**）

| 方案 | 說明 | 取捨 |
|---|---|---|
| **A（建議）新 ETL 表** | Python 引擎在 recompute pipeline 算好 → upsert `group_scenarios`；前端只讀 | 晉級數學**只存在 Python 一處**（重用 §1），**不需 TS 重寫＝不分岔**；完全比照 P8 |
| B read 時即算 | 前端/`data.ts` 即時跑分析 | 會逼著把 §5 列舉 + 跨組邏輯**移植成 TS**＝第二份實作，**正面違反**「兩條 path 會分岔」警告 |

> **決策：採 A。** 決定性論點＝避免 TS fork。資料量極小：列數 ≤ (未終場小組賽) × 3 outcome × 2 team
> ≤ 72×3×2 = 432，隨賽程推進遞減。比照 P8：recompute 觸發（改分即重算）、前端頁 `force-dynamic` 讀表。

### 8.1 Schema DDL（`etl/sql/migrations/p11.sql`；同步 `etl/sql/schema.sql`）

```sql
-- P11 (qualification scenario analysis) — deterministic FACT (no model_version).
create table group_scenarios (
  match_id       text not null references matches(match_id),
  group_label    char(1) not null,
  outcome        text not null,          -- 'home' | 'draw' | 'away'（本場結果）
  team_id        text not null references teams(team_id),
  status         text not null,          -- top2_clinched | advance_clinched | eliminated | alive
  can_win_group  boolean not null,
  secured_3rd_or_better boolean not null,
  needs_best_third boolean not null,
  seeding_live   boolean not null,       -- [A] 已鎖前二但 1 vs 2 未定
  basis_key      text not null,          -- 結構化 i18n key（前端翻譯，不存句子）
  -- match-level 旗標（denormalize 到每列，免第二張表；同一 match 各列一致）
  convenience_draw boolean not null,
  convenience_draw_kind text,            -- 'top2' | 'mutual_3rd_conditional' | null
  dead_rubber    boolean not null,
  computed_at    timestamptz not null default now(),
  primary key (match_id, outcome, team_id)
);
create index on group_scenarios (group_label);
```

> **設計：**
> - **無 `model_version`**（事實，比照 `group_standings`）。`getScenarios` **不得** filter 版本（cf. `getGroups` 的 `.eq` 別複製過來）。
> - grain = `(match_id, outcome, team_id)`＝user 要的「W/D/L × 兩隊」矩陣。
> - match-level 旗標 denormalize 到每列（同 match 各列相同），免第二張表；前端讀第一列即可。
> - `basis_key` 存 **i18n key 而非句子**（dot-free，§9），翻譯在前端（雙語對齊）；v1 不存數值欄位（保持精簡）。

### 8.2 ETL job — `etl/scenarios.py`

```
python -m etl.scenarios            # compute + upsert
python -m etl.scenarios --dry-run  # compute + print, no DB
```

```python
def run(dry_run=False):
    raw = db.fetch_group_matches_for_standings()   # 重用 P8 既有 fetch（全 group 場 + status + goals）
    # 推導組成員（同 etl/standings.py）：12 組 × 4 隊；fail-loud
    # final 場驗 goals 非 null（verify-don't-assume）
    # 每組 → engine.scenarios.analyze_group → 攤平成列 → upsert group_scenarios
```

- **db.py 新增**：`replace_group_scenarios(rows)` = **delete-all + insert**（idempotent）。讀取**重用**
  `fetch_group_matches_for_standings()`（不新增 fetch）。
- **為何 delete-all+insert 而非純 upsert**：情境列的 identity（`match_id`）會隨比賽 settle 而**消失**（終場後該場不再有情境）。
  純 upsert 會留下已終場比賽的**殘列**。本表小（≤432 列）且每 matchday 全量重算 → delete-all+insert 最乾淨。
  失敗時表暫空 → 前端 graceful `unavailable`，下次 recompute 修復（可接受）。
- **不變量（落實 §10 SC12）**：引擎**只對 `status!='final'` 的場**產情境列 → 表內 `match_id` 必不含 final 場。
- **pipeline**：[.github/workflows/recompute.yml](../.github/workflows/recompute.yml) 在 `python -m etl.standings` **之後**加
  `python -m etl.scenarios`（情境依賴最新積分事實；放 standings 後、simulate/calibrate 不相依，順序前後皆可）。

---

## 9. 前端

- **data**（`web/lib/data.ts`）新增 `getScenarios(): Promise<ScenariosResponse>`：讀 `group_scenarios` + teams，
  依 `group_label` / `match_id` 群組；**不** filter `MODEL_VERSION`（事實）；表缺（pre-migration）→ `unavailable`（graceful，§6.6）。
  - `web/lib/types.ts` 加 `ScenariosResponse` / `MatchScenarioView` / `TeamOutcomeView`。
- **呈現面（已裁決，§14.3）：獨立頁 `/scenarios`，按組編排**：
  - 每組一個區塊：**先放該組 mini 積分榜**（讀 `getStandings()`，當 context，避免與 `/standings` 跳頁）→
    **再列該組剩餘場（`status!='final'`）的情境卡**。導覽列加 `nav.scenarios`。
  - 每張情境卡：兩隊 + 三欄（home-win / draw / away-win），每格顯示**兩隊狀態徽章**（鎖前二 🟢 / 淘汰 🔴 / 存活 🟡 + 文案）。
  - `convenience_draw=true` → draw 欄醒目標記（如「握手言和雙雙晉級」）；`kind='mutual_3rd_conditional'` 用較弱措辭並標 conditional。
  - `dead_rubber` → 卡片標「**與晉級無關**」（[A]，非「無關痛癢」）；若 `seeding_live` 另標「仍爭名次/種子」。
  - `alive` / `needs_best_third` / `mutual_3rd_conditional` 格 → 附 §7 `group_sim` 機率小字（標「模型・實驗性」，受 `?v=` 影響，
    缺則不顯示）。**Guardrail**：措辭不得讀起來像 clinch（§7）。
- **沿用既有約定**：頁 `export const dynamic='force-dynamic'`（賽中即時，R1）；`displayTeamName` + name_zh fallback（trap #14）；
  國旗走 `web/lib/flag.ts`（trap #14，非 emoji）；空狀態 `EmptyState`（trap #13d）。
- **i18n**（`messages/{zh-TW,en}.json`）：`nav.scenarios` + `scenarios.*` + 各 `basis_key` 兩語**一一對齊**（TU1 parity 測試）；
  **dot-free key**（next-intl 以 `.` 為巢狀分隔，P10 B2）。狀態/依據文案皆走字典。

---

## 10. 驗收測試（PASS / FAIL）

引擎離線測試 `tests/test_scenarios.py`（純函數、無 DB、決定性、無隨機）：

| ID | 測試 | 通過條件 |
|---|---|---|
| **SC1** | sound：never-false-clinch | 構造「靠 GD 才會 clinch」的局 → 引擎標 `alive`（保守少報），**不**標 `top2_clinched` |
| **SC2** | 強義 convenience draw | draw 下兩隊積分皆已壓過另二隊（band⊆{1,2}）→ `convenience_draw=true, kind='top2'`，兩隊 `top2_clinched` |
| **SC3** | top2 clinch（純積分） | 一隊 draw 即達其餘最多隊無法追上的積分 → `top2_clinched`，與 GD 無關 |
| **SC4** | eliminated | 一隊輸即必為第 4（每 completion band={4}）→ `eliminated` |
| **SC5** | needs_best_third 不謊報 | 組內鎖第三（`secured_3rd_or_better`）但跨組未定 → `status='alive'`、`needs_best_third=true`、**非** `advance_clinched` |
| **SC6** | dead rubber | 兩隊三結果 status 皆同且終局**且皆非 seeding_live** → `dead_rubber=true`（[A]） |
| **SC7** | MD3（剩 2 場） | MD1/2 final、列舉平行場 3 種 → 狀態正確反映平行場相依 |
| **SC8** | MD2（剩 4 場、3^3 completion） | 不 crash、結果決定性、與手算一致 |
| **SC9** | 四隊同分（1994 E 組型） | 全隊同積分 → 每隊可能名次涵蓋 {1,2,3,4} → 全 `alive`（誠實，GD/抽籤未定） |
| **SC10** | 完全循環 H2H | A>B>C>A 等局不無限迴圈/不 IndexError（band 全用 `sorted`，無遞迴；沿 P8 R3） |
| **SC11** | 已含 final 場 | 組內部分 final → 鎖定不變、只列舉未定場 |
| **SC12** | idempotent / 落表 | `etl.scenarios --dry-run` 兩次輸出相同；表內無 final 場 match_id |
| **SC13** | fail-loud | 組非 4 隊 / final 缺 goals / 隊名對不上 → raise |
| **SC14** | GD-only convenience draw（[B] false-negative-by-design） | draw 後兩隊與第三隊**同積分**（band 含第 3）→ 引擎**保守不**標 `convenience_draw`（記錄為刻意 false-negative，非 bug） |
| **SC15** | seeding_live（[A]） | 兩隊皆 `top2_clinched` 但小組名次（1 vs 2）未定 → `seeding_live=true` 且 `dead_rubber=false` |

前端：`npm test`（i18n key 兩語對齊 + 狀態徽章 component test + convenience/dead-rubber 呈現）；`npm run build`（含 TS、graceful 空狀態）。

---

## 11. Edge cases（明列）

1. **MD1**：多半全 `alive`（言之過早）。引擎不特判；前端可顯示「尚早」。
2. **組內已有 final 場**：鎖定該場積分，只列舉未定場（SC11）。
3. **dead rubber / 死局**：兩隊三結果皆同終局（SC6）。
4. **四隊同分（1994 E 組）**：全 `alive`，誠實標 GD/抽籤未定（SC9）——**不**用 Elo/random 假裝分得出。
5. **完全循環 H2H**：決定性、不迴圈（SC10，沿 P8 R3）。
6. **靠 GD 的 clinch**：v1 保守標 `alive`（SC1）；GD 極值細算 = §6.2 follow-up。
7. **最後一輪同時開球**：平行場相依由列舉自然涵蓋（SC7）。
8. **比賽剛終場**：該場不再產情境列（delete-all+insert，§8.2）。
9. **雙方已晉級、名次未定（[A]）**：`seeding_live=true`、`dead_rubber=false`（SC15）；卡片標「仍爭名次/種子」。
10. **GD-only convenience draw（[B]）**：刻意 false-negative，不標 `convenience_draw`（SC14）。

---

## 12. 反陷阱對齊（CLAUDE.md）

- **trap #1**：`team_id` 兩碼，**不** hardcode 三碼。
- **trap #5（host_away）**：情境只看每隊積分/名次，與主客定向無關（同 P8）。
- **trap #7 / #13b**：事實情境與 `group_sim` 機率**清楚分離、不混算**（§7）。
- **trap #10**：只算 group stage；淘汰賽 TBD 不在範圍。
- **trap #13a**：`SUPABASE_SERVICE_KEY` 只在 server（`getScenarios` 走 `lib/supabaseServer`）。
- **trap #13d**：表缺/空 → graceful `EmptyState`。
- **trap #14**：name_zh fallback + flag.ts；i18n dot-free + 雙語對齊（P10 B2）。
- **fail-loud / idempotent / provenance**：§8.2 / §10（SC12/SC13）。

---

## 13. 檔案清單（Phase 2 實作）

```
engine/scenarios.py              [NEW]    — 純函數情境引擎（points-band 列舉 + 分類 + convenience/dead-rubber）
etl/scenarios.py                 [NEW]    — ETL job（讀 matches → 引擎 → 寫 group_scenarios；delete-then-upsert）
etl/db.py                        [MODIFY] — 新增 replace_group_scenarios()（讀重用 fetch_group_matches_for_standings）
etl/sql/migrations/p11.sql       [NEW]    — group_scenarios DDL
etl/sql/schema.sql               [MODIFY] — 同步 group_scenarios
.github/workflows/recompute.yml  [MODIFY] — 在 etl.standings 後加 etl.scenarios
tests/test_scenarios.py          [NEW]    — SC1–SC15（離線、決定性）
web/lib/data.ts                  [MODIFY] — getScenarios()（不 filter 版本；graceful）
web/lib/types.ts                 [MODIFY] — ScenariosResponse / MatchScenarioView / TeamOutcomeView
web/app/[locale]/scenarios/page.tsx [NEW] — force-dynamic 頁（獨立 /scenarios，按組編排）
web/components/ScenarioCard.tsx  [NEW]    — 三結果 × 兩隊徽章 + convenience/dead-rubber + 分離式機率覆蓋
web/components/SiteHeader.tsx    [MODIFY] — nav.scenarios
web/messages/{zh-TW,en}.json     [MODIFY] — nav.scenarios + scenarios.* + basis_key（雙語對齊、dot-free）
docs/P11-spec.md                 [本檔]
CLAUDE.md                        [MODIFY] — 現況加 P11、指令加 python -m etl.scenarios
```

---

## 14. 裁決紀錄（review 定案）

| # | 議題 | 裁決 | 併入 |
|---|---|---|---|
| 14.1 | 跨組第三名層級 | **v1-lean**（僅 conditional + 可選機率）；v1-full 不做。修正 deferral 理由（價值集中 MD3 末班車窗口）；follow-up 只做「其他全 final」的簡化版 | §6 / §6.1 / §6.2 |
| 14.2 | 後端形態 | **新表 `group_scenarios` + recompute pipeline（standings 後）** | §8 |
| 14.3 | 前端落點 | **獨立 `/scenarios` 頁，按組編排**（mini 積分榜 context + 情境卡） | §9 |
| 14.4 | 機率覆蓋層 | **放**，嚴格分離；對 `alive`/`needs_best_third`/`mutual_3rd_conditional` 附機率，標「模型・實驗性」、受 `?v=`、缺則 graceful。Guardrail：措辭不得讀起來像 clinch。澄清：hard rule #7 並列義務不適用（無對應市場盤） | §7 |
| 14.5 | GD 保守標 `alive` | **接受**（sound over-approximation，永不誤報） | §5.2 / §5.3 |
| 14.6 | convenience_draw 定義 | 確認**強義**＝draw 下兩隊皆 `top2_clinched`；`mutual_3rd_conditional` 為較弱 conditional 訊號 | §4 |
| [A] | `dead_rubber` 過度宣稱 | 文案改「與晉級無關」；新增 `seeding_live` facet；`dead_rubber` 收窄為「晉級已定 AND 名次也定」 | §4 / §5 / §8.1 / §9 / SC15 |
| [B] | `convenience_draw` GD-only false-negative | 明列為**刻意行為**（非 bug）；SC14 鎖之 | §3.3 / §4 / SC14 |

> **spec 定案，進 Phase 2 實作 + 驗收。**
