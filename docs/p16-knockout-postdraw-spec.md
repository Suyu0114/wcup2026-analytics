# P16 — 淘汰賽 post-draw 啟用（venue 預策展 ＋ odds knockout-safe ＋ recompute 兩版）

> 狀態：**code 完成（2026-06-28）**。延續 [docs/p13-knockout-page-plan.md](p13-knockout-page-plan.md)（頁面）與 [docs/p14-knockout-model-plan.md](p14-knockout-model-plan.md)（模型），把 P13 §A0 / P13 CLAUDE.md「post-draw 待補」中**抽籤後才能做**的兩個 fail-loud 缺口補上，讓淘汰賽預測一鍵跑得起來。

## Context

小組賽結束（2026-06-28）、淘汰賽抽籤落地（fd 已填 R32 真實隊伍）。探查結論：

- **前端（P13/P14/P15）已 code-complete**：`/bracket` 的 ESPN tree、ChampionOdds、KnockoutMatchCard、`getKnockout/getKnockoutSim/getBracketSlots`、`?v=`、graceful 空狀態都在。
- **引擎＋jobs 已 code-complete**：`engine/knockout.py`、`engine/bracket.py`、`engine/data/annex_c.json`、`etl/knockout_sim.py`、`etl/predict.py`（無 stage filter，一有隊即預測）。
- `recompute.yml` 已呼叫 `knockout_sim`。

因此本次 = **套 migration ＋ 補兩個 fail-loud 缺口（venue / odds）＋ recompute 兩版 ＋ runbook**；live ETL 由操作者用 creds 跑（P16 決策①）。

四個淘汰賽預測項目落點（回顧）：single-match advance %＝P13；champion / per-round / projected matchups＝P14；本頁皆已上線、本次只負責讓資料管線在 post-draw 不炸。

---

## A1. 淘汰賽 venue 預策展（fail-loud 缺口①；P13 §A0 venue）

**問題**：fd 對 WC2026 不給 venue（0/104）；任何含地主（US/CA/MX）的淘汰賽場，`venues.host_flags()` 缺 venue 會 raise。`MANUAL_VENUE` 原本只有 9 場小組賽且 key 是 fd `match_id`——抽籤前拿不到淘汰賽 fd match_id。

**作法（P16 決策②「照 FIFA 賽程全部預策展」）**：venue 由 **FIFA 比賽編號 SLOT 固定**、與晉級者無關，所以抽籤前就可知；fd 會回相同 kick-off → 以 **kickoff_utc 為 join key**，不必抽籤後逐場補 match_id。

- [etl/venues.py](../etl/venues.py)：新增 `KNOCKOUT_VENUE_BY_KICKOFF: dict[str,str]`，全 32 場淘汰賽（m73–m104）的 **kickoff_utc → venue municipality**。
  - **Provenance**：en.wikipedia.org/wiki/2026_FIFA_World_Cup_knockout_stage（slot 場館＋當地開球時間）＋ FIFA/NY-NJ 賽程的決賽（3 p.m. EDT）。當地時間換算 UTC：EDT/Toronto −4、CDT −5、PDT/Vancouver −7、Mexico CST −6（無 DST）。match no 僅供 provenance，**不當 key**。
  - **解析**：`host_flags(match_id, home_id, away_id, fd_venue=None, kickoff_utc=None)`，序：`fd_venue → MANUAL_VENUE（顯式覆寫）→ _schedule_venue(kickoff_utc)`。`_schedule_venue` 取**最近**的 slot kick-off，窗 `SCHEDULE_MATCH_WINDOW = 75 min`。
  - **唯一性論證**：實測淘汰賽 slot 最小間隔 3.5 h（210 min）＞ 2×75 min → 最近匹配唯一，且容忍 fd 時間漂移 ≤75 min。import-time 守門（fail-loud）：venue 都 ∈ `STADIUM_COUNTRY`、32 槽、無兩槽近於 2×window。
  - **R16→Final 自動涵蓋**：host 晉級後的自家場由 schedule 解析，**不必逐場手補 match_id**（這正是 §A0 venue 待補的根因）。一旦某 host 場 kick-off 對不到任何 slot（真排程異動）仍 **raise**（fail-loud）。
- [etl/ingest_fixtures.py](../etl/ingest_fixtures.py) `_match_row`：`host_flags(...)` 多傳 `f.kickoff_utc`。
- **不交換 matches 定向**：fd 把地主列客隊時走既有 `is_host_away`（對稱 −HFA，trap #5）——`host_flags` 回 `(country==home, country==away)`，地主在自家場當客隊時自然得 `(False, True)`。
- **TA1 不變量不變**：`validate()` 仍只查小組賽 host（6 home + 3 away）；淘汰賽 host 靠 schedule 策展＋fail-loud 把關。
- **交叉驗證**：操作者並行手補的 3 筆 R32 host（m73→Inglewood、m79→Mexico City、m81→Santa Clara）venue 與本 schedule **完全一致**；`MANUAL_VENUE` 取得優先（顯式 > 推導），兩者並存。

## A2. 賠率 knockout-safe 映射（fail-loud 缺口②；trap #12）

**問題**：[etl/ingest_odds.py](../etl/ingest_odds.py) `build_pair_index` 以無序隊伍對當 index，淘汰賽再遇同組對手 → frozenset collision → raise。

**作法（時間消歧，沿用既有 `SOFT_WINDOW` 思路）**：
- `build_pair_index` 回 `dict[frozenset, list[dict]]`（append，不 raise）。
- 新增 `pick_match(candidates, commence_time)`：取 kick-off 最接近 odds event `commence_time` 的候選。小組賽單候選＝原行為（identity）；淘汰賽 rematch → live odds event 落在淘汰賽那場旁、非久已 settle 的小組賽。
- `run()` 改用 `pick_match(pair_index.get(pair, []), ev.commence_time)`；既有 `SOFT_WINDOW` 漂移 warn 保留。
- **管線安全**：fixtures ingest 在 odds 前，淘汰賽場已是候選 → 不會把淘汰賽盤錯掛到舊小組賽。

## A3. recompute 兩版（P16 決策③）

[.github/workflows/recompute.yml](../.github/workflows/recompute.yml)：`simulate` 與 `knockout_sim` 各跑 `dc-v1.2` 與 `dc-v1.1`（顯式 `--model-version`），讓 `?v=` 切換器在 groups/bracket 都有資料。

## A4. 測試

- [tests/test_venues.py](../tests/test_venues.py)：schedule shape（32 槽、venue ∈ STADIUM_COUNTRY）；host 淘汰賽經 schedule 解析（home/away/neutral）；±20 min 漂移仍解析；非 host 免 venue；對不到 slot → raise。
- [tests/test_odds_mapping.py](../tests/test_odds_mapping.py)：`build_pair_index` 群組化；`pick_match` 對 rematch（小組賽＋淘汰賽兩場、不同 kick-off）路由到時間最近者；空候選回 None。
- 全離線測試 **148 passed**。

---

## B. Migration（操作者在 Supabase SQL editor 套，**最先**）

`recompute.yml` 已呼叫 `knockout_sim`，**p14.sql 未套用前任何 recompute 會寫不存在的表而炸**。
1. [etl/sql/migrations/p14.sql](../etl/sql/migrations/p14.sql) → `knockout_sim` ＋ `bracket_slot_sim`。
2. [etl/sql/migrations/p12.sql](../etl/sql/migrations/p12.sql) → `manual_results.override_fd`（若未套；ingest 對缺欄位已 graceful warn）。

## C. Runbook（操作者依序跑；接在 B 後）

```
python -m etl.ingest_fixtures                 # 收 32 場淘汰賽（有隊；venue 由 schedule 解析）
python -m etl.predict --only-unsettled        # 預測淘汰賽（dc-v1.2）
python -m etl.simulate --model-version dc-v1.2
python -m etl.simulate --model-version dc-v1.1
python -m etl.knockout_sim --model-version dc-v1.2
python -m etl.knockout_sim --model-version dc-v1.1
python -m etl.ingest_odds                     # 淘汰賽 model-vs-market / value
python -m etl.calibrate
```
先跑 dry-run 驗證：`ingest_fixtures --dry-run`（32 場有隊、host 場無 venue raise）、`ingest_odds --dry-run`（event 不再 collision）。

跑完 `/bracket`：R32 cell 因小組賽鎖定 → `bracket_slot_sim` 以 ~100% 顯示**實際晉級隊**（BracketCell ≥99.5% 隱藏機率）；R16+ feeder 結構；ChampionOdds 出奪冠/各輪機率；match cards 出 advance %＋model-vs-market。

---

## 誠實註記

- **v1.1 ≈ v1.2（淘汰賽）**：小組賽全鎖定 → group 解析兩版相同；`knockout_sim` advance 用 `fetch_team_elos()`（**非版本化**，單一 current Elo）＋共用引擎常數 → 兩版數值幾乎相同、只差 label。仍兩版都跑＝維持 pattern＋讓 `?v=` 不空。
- **v1.1 淘汰賽 match cards 走 graceful 空**：`predict` 只輸出 `MODEL_VERSION`（dc-v1.2，無 `--model-version` flag）→ `getKnockout(dc-v1.1)` 卡片空；champion odds 仍有 v1.1 列。

## 風險 / Open items

1. **schedule kick-off 漂移**：以最近匹配＋75 min 窗＋fail-loud 容錯；決賽（m104）時間取 3 p.m. EDT，若 fd 實際差 >75 min 會 raise（→ 補一筆 `MANUAL_VENUE[match_id]` 即可）。
2. **P13 item (b) 仍待**：`match_no↔fd match_id` 策展，才能把「真實場次（含比分/盤）」填進 bracket **格內**；目前真實場次走獨立 match-card 清單，bracket 格用 `bracket_slot_sim`（小組賽鎖定後即實際隊）。非阻擋。
3. **P13 item (d) 已解**：fd 抽籤後可靠填淘汰賽隊伍（操作者已取得真實 R32），不需手動 bracket 種子路徑。
