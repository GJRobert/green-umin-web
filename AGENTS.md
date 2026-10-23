# AGENTS.md：AI 開發指南

本檔案為協助 AI 開發者了解並貢獻「綠光與流求 Web 共筆（Green & Umin Web）」專案而設。

## 專案目標

「綠光與流求 Web 共筆」為一輕量、安全之網頁端小說共筆介面，託管於 Cloudflare Pages（`GreenUmin.pages.dev`）。
主要用途：
1. **閱讀**：瀏覽主線章節與設定集，支援 Obsidian 擴充 Markdown 語法（wikilink、callout、螢光、目錄跳轉等）。
2. **編輯**：提供免登入的章節草稿撰寫與回合新增功能，支援 localStorage 本地即時暫存與 Supabase 即時中繼。
3. **安全回存**：管理端透過瀏覽器原生 File System Access API 取得本地資料夾授權，比對變更 Diff 後一鍵覆寫本地檔案，完全不持有或暴露 GitHub 全庫 Token。

## 技術棧 (Tech Stack)

- **前端 (Frontend)**：Vanilla JavaScript（原生 HTML/CSS/JS），純靜態託管於 Cloudflare Pages，無繁複建置流程。
- **渲染與編輯**：`markdown-it`（含 callout, wikilink, mark 擴充）、CodeMirror 編輯器。
- **後端與即時通訊**：Supabase（Database + Realtime WebSocket），前端使用 `@supabase/supabase-js`（CDN 引入）。
- **本地落盤**：Web File System Access API（Chromium 核心瀏覽器原生支援）。

## 核心規範 (Conventions)

- **【絕對紅線】公開專案嚴禁出現私密稱呼**：專案全體（包含程式碼註解、README、測試資料、`AGENTS.md`、PR 與 Git commit 訊息），**嚴禁出現對話內對維護者或 AI 助理的私密稱呼（連舉例說明亦嚴禁列出具體暱稱）**，亦嚴禁寫入本機個人檔案絕對路徑。
- **語言與編碼**：正體中文（臺灣，`zh-TW`），UTF-8 編碼，全形標點符號。
- **縮排**：Markdown 列表縮排統一使用 4 個空格。
- **金鑰管理**：前端僅能存放 Supabase Publishable Key（`sb_publishable_...`），此金鑰受 Row Level Security (RLS) 保護，嚴禁在專案中引入具備全庫存取權之 GitHub PAT 或 Secret Key。
