# 綠光與流求 Web 共筆 (Green & Umin Web)

輕量、安全的網頁端小說共筆與章節閱讀介面，託管於 Cloudflare Pages。

## 系統特色

- **零登入負擔**：直覺開啟網頁即可閱讀與草稿編輯。
- **雙重防丟稿機制**：前端打字即時寫入 `localStorage`，點擊送出即同步至 Supabase 資料表。
- **即時推播**：利用 Supabase Realtime WebSocket 達成毫秒級變更通知。
- **安全隔離與本地直寫**：管理端透過現代瀏覽器原生之 **File System Access API** 授權，檢閱文字 Diff 後一鍵寫入本地檔案，無需常駐本機伺服器，亦無洩漏個人 GitHub 存取權限之風險。

## 部署與設定

1. 託管平台：Cloudflare Pages (`GreenUmin.pages.dev`)
2. 資料中繼：Supabase Realtime
