# CODEX FIX3 修復紀錄

對照範圍：`docs/REVIEW_D_FINDINGS.md` #1–#8。

| # | 狀態 | 修復摘要 | 驗證證據 |
|---|---|---|---|
| 1 | 已完成 | `EditController` 將 `findReplace` 納入重繪前 commit 守衛，並把編輯 keydown 抽成可測 handler。 | `編輯中的 Ctrl+F 會先 commit...` 驗證實際順序為 `commit → findReplace`，且事件已攔截。 |
| 2 | 已完成 | dissolve command 透過共用 overlay cleanup wrapper 同步移除 relations/summaries，undo/redo 一併還原或重清理。 | `dissolve 節點保留子節點時同步清理...` 驗證子節點保留、overlay 清零、undo 還原、redo 再清零。 |
| 3 | 已完成 | summary 的連續性判定新增 layout 參數；只有雙向 mindmap 依 side 分組，org/tree/timeline/fishbone 等單側佈局依 children 順序。 | `單側佈局的概要依 children 視覺順序...` 驗證 org 的相鄰 c0/c1 可建、跨過 c1 的 c0/c2 被拒絕。 |
| 4 | 已完成 | `applyLineStyle` 改用 `withLineAppearance`；只有使用者明確改 shape 才持久化 shape override。 | `只改線型不會釘住主題 shape...` 驗證 monochrome-outline 改 dotted 後切 classic-blue，shape 由 orthogonal 跟隨成 curved。 |
| 5 | 已完成 | SVG 匯出過濾 `__floating__`，並把 priority/progress/flag/emoji/symbol/sticker token 轉成人類可讀內容。 | `SVG 圖示輸出人類可讀符號...` 驗證無原始 token，且輸出 `P1`、`50%`、`⚑`、emoji、symbol。 |
| 6 | 已完成 | `documentToSvg` 讀取 `child.connector || doc.layout`；org/tree/timeline/fishbone 直接使用 render 的 `getConnectionPath`，含局部 structure override。 | `SVG 對 org/tree/timeline/fishbone...` 覆蓋 org、tree-right/left、timeline-h/v、fishbone；另測局部 org connector。 |
| 7 | 已完成 | 移除 export 的 `mirrorLeftLayout` 二次鏡像，保留 layout engine 原生 left 座標。 | `mindmap-left SVG 保留 layout 原生向左座標...` 驗證 child centerX 小於 root centerX。 |
| 8 | 已完成 | SVG layout 後、bounds 前套用與 render 相同的 root-centered spacing transform。 | `SVG 套用文件水平與垂直 spacing...` 驗證 spacing 30→80 時水平與垂直中心距離皆為 2 倍。 |

## 驗證

- 語法：`node --check` 檢查本輪修改的 5 個 production JS 與 3 個 test MJS，全部 exit 0。
- 完整測試：`node --test <tests\*.test.mjs 全部檔案>`。
- 結果：5/5 test files 通過；內部斷言合計 73/73（core 24、delta 15、IO 18、layout 7、store/search 9）。

## 修改範圍

- `js/editor/edit.js`
- `js/editor/keyboard.js`
- `js/editor/relations.js`
- `js/editor/summary.js`
- `js/io/export.js`
- `tests/core.test.mjs`
- `tests/delta.test.mjs`
- `tests/io.test.mjs`
- `docs/CODEX_FIX3_NOTES.md`

`findreplace.js` 無需修改；#1 的根因位於編輯 session 對全域 action 的 commit 守衛。
