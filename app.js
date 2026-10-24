// 綠光與流求 Web 共筆 - 前端邏輯
const SUPABASE_URL = "https://qofxozylnbgkfhcxikdp.supabase.co";
const SUPABASE_KEY = "sb_publishable_O8HGoBrik2nrccdap3IeRg_H6o5v7yj";

let supabaseClient = null;
let currentFile = "5.md";
let localDirHandle = null;
let latestCloudContent = "";
let autoWriteLocal = false;

// 初始化 Markdown-it
const md = window.markdownit({
  html: true,
  breaks: true,
  linkify: true
});

// DOM 元素快取
const badge = document.getElementById("connection-badge");
const chapterList = document.getElementById("chapter-list");
const settingList = document.getElementById("setting-list");
const currentFileDisplay = document.getElementById("current-filename");
const draftStatusDisplay = document.getElementById("draft-status");
const viewPanel = document.getElementById("view-panel");
const editPanel = document.getElementById("edit-panel");
const adminPanel = document.getElementById("admin-panel");
const markdownRender = document.getElementById("markdown-render");
const editorTextarea = document.getElementById("editor-textarea");
const editorPreview = document.getElementById("editor-preview");
const btnViewMode = document.getElementById("btn-view-mode");
const btnEditMode = document.getElementById("btn-edit-mode");
const btnNewRound = document.getElementById("btn-new-round");
const btnSaveDraft = document.getElementById("btn-save-draft");
const btnToggleAdmin = document.getElementById("btn-toggle-admin");
const btnCloseAdmin = document.getElementById("btn-close-admin");
const btnSelectDir = document.getElementById("btn-select-dir");
const btnWriteVault = document.getElementById("btn-write-vault");
const selectedDirName = document.getElementById("selected-dir-name");
const diffDisplay = document.getElementById("diff-display");
const autoWriteToggle = document.getElementById("auto-write-toggle");
const btnSyncAllLocal = document.getElementById("btn-sync-all-local");
const syncAllStatus = document.getElementById("sync-all-status");

// 新增回合與優化元素快取
const newRoundPanel = document.getElementById("new-round-panel");
const newRoundHistoryContent = document.getElementById("new-round-history-content");
const btnScrollBottomHistory = document.getElementById("btn-scroll-bottom-history");
const newRoundTextarea = document.getElementById("new-round-textarea");
const newRoundPreview = document.getElementById("new-round-preview");
const newRoundTitle = document.getElementById("new-round-title");
const btnCancelRound = document.getElementById("btn-cancel-round");
const btnSubmitRound = document.getElementById("btn-submit-round");
const lastGmBox = document.getElementById("last-gm-box");
const lastGmTitle = document.getElementById("last-gm-title");
const lastGmContent = document.getElementById("last-gm-content");
const btnToggleGmContext = document.getElementById("btn-toggle-gm-context");
const toggleSplitPreview = document.getElementById("toggle-split-preview");
const editPreviewPane = document.getElementById("edit-preview-pane");

// 防抖計時器
let fullTextDraftTimer = null;
let fullTextPreviewTimer = null;
let newRoundDraftTimer = null;

// 啟動函式
window.addEventListener("DOMContentLoaded", () => {
  initSupabase();
  setupEventListeners();
  loadDocument(currentFile);
});

// 1. 初始化 Supabase 與即時廣播
function initSupabase() {
  try {
    if (window.supabase) {
      supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
      badge.textContent = "已連線";
      badge.className = "badge badge-connected";

      // 訂閱資料表變更
      supabaseClient
        .channel("realtime-drafts")
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "green_umin_drafts" },
          (payload) => {
            handleRealtimeEvent(payload);
          }
        )
        .subscribe((status) => {
          if (status === "SUBSCRIBED") {
            badge.textContent = "即時監聽中";
          }
        });
    }
  } catch (err) {
    console.error("Supabase 初始化失敗：", err);
    badge.textContent = "連線異常";
    badge.className = "badge badge-disconnected";
  }
}

// 處理 Realtime 收到新資料
async function handleRealtimeEvent(payload) {
  const row = payload.new;
  if (!row || row.id !== currentFile) return;

  latestCloudContent = row.content;
  diffDisplay.textContent = `[${new Date().toLocaleTimeString()}] 收到雲端最新草稿 (作者: ${row.author || "未知"})：\n長度：${row.content.length} 字元\n\n預覽首 300 字：\n${row.content.substring(0, 300)}...`;
  btnWriteVault.disabled = !localDirHandle;

  // 如果管理者開啟了「自動寫入」，且已授權本地目錄，直接落盤
  if (autoWriteLocal && localDirHandle) {
    await writeToLocalVault(currentFile, row.content);
  }
}

// 2. 切換載入檔案
async function loadDocument(filename) {
  currentFile = filename;
  currentFileDisplay.textContent = filename;

  // 判斷是否為設定集（唯讀）
  const isEditable = filename.endsWith(".md") && /^\d+\.md$/.test(filename);
  btnEditMode.style.display = isEditable ? "inline-block" : "none";
  btnNewRound.style.display = isEditable ? "inline-block" : "none";

  // 檢查 localStorage 草稿
  const localDraft = localStorage.getItem("draft_" + filename);
  if (localDraft) {
    draftStatusDisplay.textContent = "有未送出的本機草稿";
    editorTextarea.value = localDraft;
  } else {
    draftStatusDisplay.textContent = "無本機未存草稿";
  }

  // 從 Supabase 取得最新草稿
  if (supabaseClient) {
    try {
      const { data, error } = await supabaseClient
        .from("green_umin_drafts")
        .select("content")
        .eq("id", filename)
        .single();

      if (data && data.content) {
        latestCloudContent = data.content;
        if (!localDraft) {
          editorTextarea.value = data.content;
        }
        renderContent(localDraft || data.content);
        return;
      }
    } catch (e) {
      console.warn("尚未有該檔雲端草稿：", e);
    }
  }

  // 若無雲端資料，以預設或本地草稿呈現
  renderContent(localDraft || `# ${filename}\n\n（尚無文字或初次載入）`);
}

// 渲染 Markdown
function renderContent(rawText) {
  // 處理簡易 wikilink [[text]]
  let processed = rawText.replace(/\[\[(.*?)\]\]/g, (match, p1) => {
    const parts = p1.split("|");
    const label = parts[1] || parts[0];
    return `<span class="wikilink" style="color: #2b7a78; font-weight: 500;">${label}</span>`;
  });

  // 處理 ==螢光==
  processed = processed.replace(/==(.*?)==/g, "<mark>$1</mark>");

  // 產生 H2 回合錨點與快速導覽列（相容：年份 User、年份 GM、User 序號、Turn 回合）
  const rounds = [];
  processed = processed.replace(/^##\s+([^\n#]+)$/gm, (match, title) => {
    const trimmed = title.trim();
    const slug = "round-" + encodeURIComponent(trimmed.replace(/\s+/g, "-").toLowerCase());
    rounds.push({ title: trimmed, slug });
    return `## <span id="${slug}">${trimmed}</span>`;
  });

  let tocHtml = "";
  if (rounds.length > 0) {
    // 列出最後 15 個回合快速跳轉按鈕
    const recentRounds = rounds.slice(-15);
    const buttons = recentRounds
      .map((r) => {
        let tagClass = "toc-tag";
        if (r.title.includes("User")) tagClass += " toc-tag-user";
        else if (r.title.includes("GM")) tagClass += " toc-tag-gm";
        else if (r.title.includes("Turn")) tagClass += " toc-tag-turn";
        return `<a href="#${r.slug}" class="${tagClass}">${r.title}</a>`;
      })
      .join(" ");
    tocHtml = `<div class="toc-bar"><strong>📍 快速跳轉回合：</strong>${buttons}</div>`;
  }

  // 渲染 HTML
  markdownRender.innerHTML = tocHtml + md.render(processed);
  editorPreview.innerHTML = md.render(processed);
}

// 3. 事件監聽
function setupEventListeners() {
  // 邊欄選檔
  chapterList.addEventListener("click", (e) => {
    if (e.target.tagName === "LI") {
      updateActiveFile(e.target);
      loadDocument(e.target.dataset.file);
    }
  });

  settingList.addEventListener("click", (e) => {
    if (e.target.tagName === "LI") {
      updateActiveFile(e.target);
      loadDocument(e.target.dataset.file);
    }
  });

  // 檢視與編輯模式切換
  btnViewMode.addEventListener("click", () => {
    viewPanel.style.display = "block";
    editPanel.style.display = "none";
    if (newRoundPanel) newRoundPanel.style.display = "none";
    btnViewMode.classList.add("btn-active");
    btnEditMode.classList.remove("btn-active");
  });

  btnEditMode.addEventListener("click", () => {
    viewPanel.style.display = "none";
    editPanel.style.display = "flex";
    if (newRoundPanel) newRoundPanel.style.display = "none";
    btnEditMode.classList.add("btn-active");
    btnViewMode.classList.remove("btn-active");
    if (toggleSplitPreview && toggleSplitPreview.checked) {
      editorPreview.innerHTML = md.render(editorTextarea.value);
    }
  });

  // 全文編輯打字防抖暫存與預覽（徹底消除大檔打字延遲）
  editorTextarea.addEventListener("input", () => {
    draftStatusDisplay.textContent = "打字中... (未儲存)";

    clearTimeout(fullTextDraftTimer);
    fullTextDraftTimer = setTimeout(() => {
      const text = editorTextarea.value;
      localStorage.setItem("draft_" + currentFile, text);
      draftStatusDisplay.textContent = "已暫存於本機 (未送出)";
    }, 800);

    if (toggleSplitPreview && toggleSplitPreview.checked) {
      clearTimeout(fullTextPreviewTimer);
      fullTextPreviewTimer = setTimeout(() => {
        const text = editorTextarea.value;
        editorPreview.innerHTML = md.render(text);
      }, 500);
    }
  });

  if (toggleSplitPreview) {
    toggleSplitPreview.addEventListener("change", (e) => {
      if (editPreviewPane) {
        editPreviewPane.style.display = e.target.checked ? "flex" : "none";
        if (e.target.checked) {
          editorPreview.innerHTML = md.render(editorTextarea.value);
        }
      }
    });
  }

  // 送出全文至 Supabase
  btnSaveDraft.addEventListener("click", async () => {
    const text = editorTextarea.value;
    if (!supabaseClient) return alert("Supabase 尚未連線！");

    btnSaveDraft.disabled = true;
    btnSaveDraft.textContent = "傳送中...";

    try {
      const { error } = await supabaseClient
        .from("green_umin_drafts")
        .upsert({
          id: currentFile,
          content: text,
          author: "義捷",
          updated_at: new Date().toISOString()
        });

      if (error) throw error;

      alert("已成功送出儲存至雲端！");
      draftStatusDisplay.textContent = "草稿已與雲端同步";
      localStorage.removeItem("draft_" + currentFile);
      latestCloudContent = text;
      renderContent(text);
    } catch (err) {
      alert("送出失敗：" + err.message);
    } finally {
      btnSaveDraft.disabled = false;
      btnSaveDraft.textContent = "送出全文至雲端";
    }
  });

  // 新增回合快捷按鈕：開啟「輕量極速模式」（避免載入 50 萬字大檔，打字 0 延遲）
  btnNewRound.addEventListener("click", () => {
    viewPanel.style.display = "none";
    editPanel.style.display = "none";
    if (newRoundPanel) newRoundPanel.style.display = "flex";
    btnViewMode.classList.remove("btn-active");
    btnEditMode.classList.remove("btn-active");

    const baseContent = latestCloudContent || editorTextarea.value || "";

    // 在左半面板渲染前文歷史紀錄，並自動滾動至最底部（最新背景）
    if (newRoundHistoryContent) {
      let processedHistory = baseContent.replace(/\[\[(.*?)\]\]/g, (match, p1) => {
        const parts = p1.split("|");
        const label = parts[1] || parts[0];
        return `<span class="wikilink" style="color: #2b7a78; font-weight: 500;">${label}</span>`;
      });
      processedHistory = processedHistory.replace(/==(.*?)==/g, "<mark>$1</mark>");
      newRoundHistoryContent.innerHTML = md.render(processedHistory);
      setTimeout(() => {
        newRoundHistoryContent.scrollTop = newRoundHistoryContent.scrollHeight;
      }, 50);
    }

    // 計算下一個 User 回合標題
    const yearMatches = [...baseContent.matchAll(/##\s*(\d{4})\s*(User|GM)/gi)];
    let targetHeading = "## User 1";
    if (yearMatches.length > 0) {
      const last = yearMatches[yearMatches.length - 1];
      const lastYear = parseInt(last[1], 10);
      const lastRole = last[2].toUpperCase();
      const nextYear = lastRole === "GM" ? lastYear + 1 : lastYear + 1;
      targetHeading = `## ${nextYear} User`;
    } else {
      const matches = [...baseContent.matchAll(/##\s*User\s*(\d+)/gi)];
      if (matches.length > 0) {
        const nextNum = parseInt(matches[matches.length - 1][1], 10) + 1;
        targetHeading = `## User ${nextNum}`;
      }
    }

    if (newRoundTitle) {
      newRoundTitle.textContent = `✍️ 撰寫新回合（極速模式） - ${targetHeading}`;
    }

    // 檢查是否有本回合草稿
    const savedRoundDraft = localStorage.getItem("new_round_" + currentFile);
    if (newRoundTextarea) {
      if (savedRoundDraft) {
        newRoundTextarea.value = savedRoundDraft;
      } else {
        newRoundTextarea.value = `${targetHeading}\n\n`;
      }
      if (newRoundPreview) {
        newRoundPreview.innerHTML = md.render(newRoundTextarea.value);
      }
      newRoundTextarea.focus();
      newRoundTextarea.selectionStart = newRoundTextarea.value.length;
      newRoundTextarea.selectionEnd = newRoundTextarea.value.length;
    }
  });

  // 新回合編輯打字事件
  if (newRoundTextarea) {
    newRoundTextarea.addEventListener("input", () => {
      const text = newRoundTextarea.value;
      if (newRoundPreview) {
        newRoundPreview.innerHTML = md.render(text);
      }
      clearTimeout(newRoundDraftTimer);
      newRoundDraftTimer = setTimeout(() => {
        localStorage.setItem("new_round_" + currentFile, text);
      }, 400);
    });
  }

  if (btnToggleGmContext && lastGmContent) {
    btnToggleGmContext.addEventListener("click", () => {
      if (lastGmContent.style.display === "none") {
        lastGmContent.style.display = "block";
        btnToggleGmContext.textContent = "收合";
      } else {
        lastGmContent.style.display = "none";
        btnToggleGmContext.textContent = "展開";
      }
    });
  }

  if (btnScrollBottomHistory && newRoundHistoryContent) {
    btnScrollBottomHistory.addEventListener("click", () => {
      newRoundHistoryContent.scrollTo({
        top: newRoundHistoryContent.scrollHeight,
        behavior: "smooth"
      });
    });
  }

  if (btnCancelRound) {
    btnCancelRound.addEventListener("click", () => {
      if (newRoundPanel) newRoundPanel.style.display = "none";
      viewPanel.style.display = "block";
      btnViewMode.classList.add("btn-active");
    });
  }

  if (btnSubmitRound) {
    btnSubmitRound.addEventListener("click", async () => {
      const newRoundText = newRoundTextarea.value.trim();
      if (!newRoundText) return alert("新回合內容不可為空！");
      if (!supabaseClient) return alert("Supabase 尚未連線！");

      if (!confirm("確定要送出此新回合至雲端嗎？")) return;

      btnSubmitRound.disabled = true;
      btnSubmitRound.textContent = "傳送中...";

      try {
        let baseContent = latestCloudContent;
        if (!baseContent) {
          const { data } = await supabaseClient
            .from("green_umin_drafts")
            .select("content")
            .eq("id", currentFile)
            .single();
          baseContent = data && data.content ? data.content : "";
        }

        const mergedContent = baseContent.trim() + "\n\n" + newRoundText + "\n";

        const { error } = await supabaseClient
          .from("green_umin_drafts")
          .upsert({
            id: currentFile,
            content: mergedContent,
            author: "義捷",
            updated_at: new Date().toISOString()
          });

        if (error) throw error;

        alert("🎉 新回合已成功送出至雲端！");
        localStorage.removeItem("new_round_" + currentFile);
        latestCloudContent = mergedContent;
        editorTextarea.value = mergedContent;
        renderContent(mergedContent);

        if (newRoundPanel) newRoundPanel.style.display = "none";
        viewPanel.style.display = "block";
        btnViewMode.classList.add("btn-active");

        setTimeout(() => {
          viewPanel.scrollTop = viewPanel.scrollHeight;
        }, 100);
      } catch (err) {
        alert("送出失敗：" + err.message);
      } finally {
        btnSubmitRound.disabled = false;
        btnSubmitRound.textContent = "送出新回合";
      }
    });
  }

  // 管理端面板切換
  btnToggleAdmin.addEventListener("click", () => {
    adminPanel.style.display = adminPanel.style.display === "none" ? "block" : "none";
  });
  btnCloseAdmin.addEventListener("click", () => {
    adminPanel.style.display = "none";
  });

  // File System Access API 授權本機資料夾
  btnSelectDir.addEventListener("click", async () => {
    if (!window.showDirectoryPicker) {
      return alert("您的瀏覽器不支援 File System Access API，請使用 Chrome、Edge 或 Arc！");
    }
    try {
      localDirHandle = await window.showDirectoryPicker({ mode: "readwrite" });
      selectedDirName.textContent = `已掛載本機目錄：${localDirHandle.name}`;
      selectedDirName.style.color = "#2b7a78";
      btnWriteVault.disabled = !latestCloudContent;
      if (btnSyncAllLocal) btnSyncAllLocal.disabled = false;
    } catch (err) {
      if (err.name !== "AbortError") {
        alert("授權失敗：" + err.message);
      }
    }
  });

  // 一鍵推送本機所有 Markdown 至雲端
  if (btnSyncAllLocal) {
    btnSyncAllLocal.addEventListener("click", async () => {
      if (!localDirHandle) return alert("請先選擇本機資料夾！");
      if (!supabaseClient) return alert("Supabase 尚未連線！");
      if (!confirm("確定要將本機資料夾內的所有 .md 檔案推送到雲端 Supabase 嗎？")) return;

      btnSyncAllLocal.disabled = true;
      syncAllStatus.textContent = "全量同步中...";

      try {
        let count = 0;
        for await (const entry of localDirHandle.values()) {
          if (entry.kind === "file" && entry.name.endsWith(".md")) {
            const file = await entry.getFile();
            const text = await file.text();
            await supabaseClient.from("green_umin_drafts").upsert({
              id: entry.name,
              content: text,
              author: "本機同步",
              updated_at: new Date().toISOString()
            });
            count++;
          }
        }
        syncAllStatus.textContent = `成功同步 ${count} 個檔案至雲端！`;
        alert(`已成功將本機 ${count} 個 Markdown 檔案同步至雲端 Supabase！`);
        loadDocument(currentFile);
      } catch (e) {
        console.error("全量同步失敗：", e);
        syncAllStatus.textContent = "同步失敗：" + e.message;
        alert("全量同步失敗：" + e.message);
      } finally {
        btnSyncAllLocal.disabled = false;
      }
    });
  }

  // 一鍵寫入本機 Vault
  btnWriteVault.addEventListener("click", async () => {
    if (!localDirHandle) return alert("請先選擇本機資料夾！");
    if (!latestCloudContent) return alert("尚無雲端內容可寫入！");
    await writeToLocalVault(currentFile, latestCloudContent);
  });

  autoWriteToggle.addEventListener("change", (e) => {
    autoWriteLocal = e.target.checked;
  });
}

// 輔助：寫入本機檔案
async function writeToLocalVault(filename, content) {
  try {
    const fileHandle = await localDirHandle.getFileHandle(filename, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(content);
    await writable.close();
    diffDisplay.textContent = `[${new Date().toLocaleTimeString()}] 已成功寫入本機 Vault: ${filename}！Obsidian 已同步變更。`;
  } catch (err) {
    console.error("本機寫入失敗：", err);
    alert("本機寫入失敗：" + err.message);
  }
}

function updateActiveFile(targetLi) {
  document.querySelectorAll(".file-list li").forEach((li) => li.classList.remove("active"));
  targetLi.classList.add("active");
}
