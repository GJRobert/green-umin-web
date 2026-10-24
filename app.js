// 綠光與流求 Web 共筆 - 前端邏輯
const SUPABASE_URL = "https://qofxozylnbgkfhcxikdp.supabase.co";
const SUPABASE_KEY = "sb_publishable_O8HGoBrik2nrccdap3IeRg_H6o5v7yj";

let supabaseClient = null;
let currentFile = "6.md";
let localDirHandle = null;
let localFallbackFiles = new Map(); // 支援 Zen / Firefox 資料夾讀取比對
let latestCloudContent = "";
let previousCloudContent = "";
let latestCloudAuthor = "";
let latestCloudUpdatedAt = "";
let currentDiffMode = "smart"; // 'smart' | 'rounds' | 'tail'
let roundEditMode = "append_current"; // 'append_current' (補充當前回合) | 'new_next' (開啟下一回合)
let autoWriteLocal = false;

// 初始化 Markdown-it
const md = window.markdownit({
  html: true,
  breaks: true,
  linkify: true
});

// DOM 元素快取
const badge = document.getElementById("connection-badge");
const authorRoleSelect = document.getElementById("author-role-select");
const chapterList = document.getElementById("chapter-list");
const settingList = document.getElementById("setting-list");
const currentFileDisplay = document.getElementById("current-filename");
const cloudMetaStatus = document.getElementById("cloud-meta-status");
const draftStatusDisplay = document.getElementById("draft-status");
const viewPanel = document.getElementById("view-panel");
const adminPanel = document.getElementById("admin-panel");
const markdownRender = document.getElementById("markdown-render");
const btnNewRound = document.getElementById("btn-new-round");
const btnToggleAdmin = document.getElementById("btn-toggle-admin");
const adminAlertDot = document.getElementById("admin-alert-dot");
const btnCloseAdmin = document.getElementById("btn-close-admin");
const btnSelectDir = document.getElementById("btn-select-dir");
const fallbackDirInput = document.getElementById("fallback-dir-input");
const btnWriteVault = document.getElementById("btn-write-vault");
const btnCopyLatestRound = document.getElementById("btn-copy-latest-round");
const btnDownloadCloudMd = document.getElementById("btn-download-cloud-md");
const selectedDirName = document.getElementById("selected-dir-name");
const diffSummaryBar = document.getElementById("diff-summary-bar");
const diffDisplay = document.getElementById("diff-display");
const btnDiffModeSmart = document.getElementById("btn-diff-mode-smart");
const btnDiffModeRounds = document.getElementById("btn-diff-mode-rounds");
const btnDiffModeTail = document.getElementById("btn-diff-mode-tail");
const autoWriteToggle = document.getElementById("auto-write-toggle");
const btnSyncAllLocal = document.getElementById("btn-sync-all-local");
const syncAllStatus = document.getElementById("sync-all-status");

// 頂部雲端警示橫幅元素
const cloudAlertBanner = document.getElementById("cloud-alert-banner");
const cloudAlertTitle = document.getElementById("cloud-alert-title");
const cloudAlertDetail = document.getElementById("cloud-alert-detail");
const btnAlertViewDiff = document.getElementById("btn-alert-view-diff");
const btnAlertJumpBottom = document.getElementById("btn-alert-jump-bottom");
const btnAlertCopyLatest = document.getElementById("btn-alert-copy-latest");
const btnAlertDismiss = document.getElementById("btn-alert-dismiss");

// 新增回合與優化元素快取
const newRoundSide = document.getElementById("new-round-side");
const newRoundTextarea = document.getElementById("new-round-textarea");
const newRoundPreview = document.getElementById("new-round-preview");
const newRoundTitle = document.getElementById("new-round-title");
const btnSwitchRoundMode = document.getElementById("btn-switch-round-mode");
const btnCancelRound = document.getElementById("btn-cancel-round");
const btnSubmitRound = document.getElementById("btn-submit-round");

// 防抖計時器
let newRoundDraftTimer = null;

function getCurrentAuthor() {
  return (authorRoleSelect && authorRoleSelect.value) || localStorage.getItem("green_umin_author_role") || "義捷";
}

// 啟動函式
window.addEventListener("DOMContentLoaded", async () => {
  const savedRole = localStorage.getItem("green_umin_author_role");
  if (authorRoleSelect && savedRole) {
    authorRoleSelect.value = savedRole;
  }
  initSupabase();
  setupEventListeners();
  await refreshChapterListFromCloud(true);
});

// 從 Supabase 動態載入所有主線章節清單（例如新增 6.md, 7.md 時自動抓取並將最新章節排第一）
async function refreshChapterListFromCloud(loadNewest = false) {
  if (!supabaseClient) {
    loadDocument(currentFile);
    return;
  }
  try {
    const { data } = await supabaseClient
      .from("green_umin_drafts")
      .select("id");
    if (data && data.length > 0) {
      const chapters = data
        .map((r) => r.id)
        .filter((id) => /^\d+\.md$/.test(id))
        .sort((a, b) => parseInt(b, 10) - parseInt(a, 10));
      if (chapters.length > 0 && chapterList) {
        if (loadNewest) {
          currentFile = chapters[0];
        }
        chapterList.innerHTML = chapters
          .map((ch) => {
            const num = parseInt(ch, 10);
            const activeCls = ch === currentFile ? ' class="active"' : "";
            return `<li data-file="${ch}"${activeCls}>第 ${num} 章 (${ch})</li>`;
          })
          .join("");
      }
    }
  } catch (e) {
    console.warn("動態讀取章節列表失敗：", e);
  }
  loadDocument(currentFile);
}

// 播放清脆雙音提示音 (Web Audio API，免外部音檔)
function playNotificationSound() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;
    [587.33, 880].forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, now + idx * 0.14);
      gain.gain.setValueAtTime(0.15, now + idx * 0.14);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.14 + 0.35);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + idx * 0.14);
      osc.stop(now + idx * 0.14 + 0.36);
    });
  } catch (e) {
    // 瀏覽器若未互動阻擋音效則靜默略過
  }
}

function formatLocalTime(isoStr) {
  if (!isoStr) return "未知時間";
  try {
    const d = new Date(isoStr);
    return d.toLocaleString("zh-TW", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false
    });
  } catch (e) {
    return isoStr;
  }
}

// 內容雜湊計算（正規化換行與頭尾空白，避免僅時間戳不同而內容相同時誤彈通知）
function contentHash(text) {
  const norm = String(text || "").replace(/\r\n/g, "\n").trim();
  let h = 5381;
  for (let i = 0; i < norm.length; i++) {
    h = ((h << 5) + h + norm.charCodeAt(i)) | 0;
  }
  return norm.length + ":" + (h >>> 0).toString(36);
}

function getSeenHash(filename) {
  return localStorage.getItem("seen_hash_" + filename);
}

function markSeen(filename, content) {
  if (filename && typeof content === "string") {
    localStorage.setItem("seen_hash_" + filename, contentHash(content));
  }
}

// 紀錄當前頂部警示橫幅所指向的目標檔案與內容（解決跨檔通知點開 Diff 仍停在舊檔的問題）
let alertTargetFile = null;
let alertTargetContent = null;

// 顯示醒目雲端更新警示
function triggerCloudAlert({ filename, author, updatedAt, isRealtime = false, summaryText = "", content = null }) {
  alertTargetFile = filename;
  alertTargetContent = content;
  const timeStr = formatLocalTime(updatedAt);
  if (cloudAlertBanner) {
    cloudAlertBanner.style.display = "flex";
    cloudAlertTitle.textContent = isRealtime
      ? `🔔 【即時新稿推播】${author || "共筆者"} 剛送出了《${filename}》最新內容！`
      : `🔔 【雲端有最新進度】《${filename}》最後由「${author || "共筆者"}」更新`;
    cloudAlertDetail.textContent = `（時間：${timeStr}${summaryText ? " ｜ " + summaryText : ""}）`;
  }
  if (adminAlertDot) adminAlertDot.style.display = "inline-block";
  if (btnToggleAdmin) btnToggleAdmin.classList.add("btn-admin-has-alert");
  if (cloudMetaStatus) cloudMetaStatus.classList.add("meta-new");
  document.title = `🔴 [新稿!] 綠光與流求 Web 共筆 (${filename})`;
  if (isRealtime) {
    playNotificationSound();
  }
}

function dismissCloudAlert() {
  if (cloudAlertBanner) cloudAlertBanner.style.display = "none";
  if (adminAlertDot) adminAlertDot.style.display = "none";
  if (btnToggleAdmin) btnToggleAdmin.classList.remove("btn-admin-has-alert");
  if (cloudMetaStatus) cloudMetaStatus.classList.remove("meta-new");
  document.title = "綠光與流求 Web 共筆";
  if (alertTargetFile && typeof alertTargetContent === "string") {
    markSeen(alertTargetFile, alertTargetContent);
  }
  if (currentFile && latestCloudContent) {
    markSeen(currentFile, latestCloudContent);
  }
  if (currentFile && latestCloudUpdatedAt) {
    localStorage.setItem("ack_cloud_" + currentFile, latestCloudUpdatedAt);
  }
  alertTargetFile = null;
  alertTargetContent = null;
}

// 若橫幅警示的是別的檔案，點橫幅按鈕時自動切換至該檔案再開啟 Diff / 跳轉
async function ensureAlertFileLoaded() {
  if (alertTargetFile && alertTargetFile !== currentFile) {
    const targetLi = document.querySelector(`.file-list li[data-file="${alertTargetFile}"]`);
    if (targetLi) updateActiveFile(targetLi);
    await loadDocument(alertTargetFile, { skipAlertCheck: true });
  }
}

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
  if (!row) return;

  // 若是新建立的主線章節（例如拆檔 6.md, 7.md），自動重新載入左側章節列表
  if (/^\d+\.md$/.test(row.id) && chapterList && !chapterList.querySelector(`li[data-file="${row.id}"]`)) {
    await refreshChapterListFromCloud(false);
  }

  const incomingContent = row.content || "";
  const oldRecordContent = payload.old && typeof payload.old.content === "string" ? payload.old.content : null;
  const isSameAsOldRecord = oldRecordContent !== null && contentHash(oldRecordContent) === contentHash(incomingContent);
  const isSameAsSeen = getSeenHash(row.id) === contentHash(incomingContent);

  // 若更新的是其他章節
  if (row.id !== currentFile) {
    if (row.author === getCurrentAuthor() || row.author === "本機同步") {
      markSeen(row.id, incomingContent);
      return;
    }
    // 只有當內容真的有變（且本機尚未看過相同內容）時才跳出橫幅提醒
    if (row.author && !isSameAsOldRecord && !isSameAsSeen) {
      const latestRound = extractLatestRounds(incomingContent, 1)[0];
      triggerCloudAlert({
        filename: row.id,
        author: row.author,
        updatedAt: row.updated_at || new Date().toISOString(),
        isRealtime: true,
        summaryText: latestRound
          ? `最新段落：${latestRound.heading}（點「檢視最新編輯」自動切換至 ${row.id}）`
          : `點「檢視最新編輯」自動切換至 ${row.id}`,
        content: incomingContent
      });
    }
    return;
  }

  const isSameAsCurrentMemory = latestCloudContent && contentHash(latestCloudContent) === contentHash(incomingContent);
  const oldLen = latestCloudContent ? latestCloudContent.length : 0;
  if (!isSameAsCurrentMemory) {
    previousCloudContent = oldRecordContent !== null ? oldRecordContent : latestCloudContent;
  }
  latestCloudContent = incomingContent;
  latestCloudAuthor = row.author || "義捷";
  latestCloudUpdatedAt = row.updated_at || new Date().toISOString();

  const diffChars = latestCloudContent.length - oldLen;
  const diffSign = diffChars >= 0 ? `+${diffChars}` : `${diffChars}`;

  if (cloudMetaStatus) {
    cloudMetaStatus.textContent = `☁️ 雲端最新：${latestCloudAuthor} (${formatLocalTime(latestCloudUpdatedAt)}) · 共 ${latestCloudContent.length.toLocaleString()} 字`;
  }

  // 即時更新全篇閱讀畫面
  renderContent(latestCloudContent);

  // 更新管理端 Diff 視圖（直擊最新回合與變更）
  await updateDiffView();
  btnWriteVault.disabled = !localDirHandle;

  // 若是自己送出或「本機同步」，或內容與上次已讀／送出完全一致（僅時間戳改變），直接記錄已讀、不跳假警報！
  if (
    latestCloudAuthor === getCurrentAuthor() ||
    latestCloudAuthor === "本機同步" ||
    isSameAsOldRecord ||
    isSameAsSeen ||
    isSameAsCurrentMemory
  ) {
    markSeen(currentFile, latestCloudContent);
  } else {
    const latestRound = extractLatestRounds(latestCloudContent, 1)[0];
    const roundHint = latestRound ? `最新回合：${latestRound.heading} (${diffSign} 字)` : `字數變化：${diffSign} 字`;
    triggerCloudAlert({
      filename: currentFile,
      author: latestCloudAuthor,
      updatedAt: latestCloudUpdatedAt,
      isRealtime: true,
      summaryText: roundHint,
      content: latestCloudContent
    });
  }

  // 如果管理者開啟了「自動寫入」，且已授權本地目錄，直接落盤
  if (autoWriteLocal && localDirHandle) {
    await writeToLocalVault(currentFile, row.content);
  }
}

// 2. 切換載入檔案
async function loadDocument(filename, options = {}) {
  currentFile = filename;
  currentFileDisplay.textContent = filename;

  // 判斷是否為主線章節或設定筆記（兩者皆支援編輯）
  const isStoryChapter = filename.endsWith(".md") && /^\d+\.md$/.test(filename);
  btnNewRound.style.display = "inline-block";
  btnNewRound.textContent = isStoryChapter ? "✍️ 新增回合" : "✏️ 編輯筆記";

  draftStatusDisplay.textContent = "";

  // 從 Supabase 取得最新草稿（含 author 與 updated_at）
  if (supabaseClient) {
    try {
      const { data, error } = await supabaseClient
        .from("green_umin_drafts")
        .select("content, author, updated_at")
        .eq("id", filename)
        .single();

      if (data && data.content) {
        latestCloudContent = data.content;
        latestCloudAuthor = data.author || "未知";
        latestCloudUpdatedAt = data.updated_at || "";

        if (cloudMetaStatus) {
          cloudMetaStatus.textContent = `☁️ 雲端最新：${latestCloudAuthor} (${formatLocalTime(latestCloudUpdatedAt)}) · 共 ${latestCloudContent.length.toLocaleString()} 字`;
        }

        renderContent(data.content);

        // 同步更新管理端 Diff 檢視器（確保隨時打開都能看到最新回合與檔尾差異）
        await updateDiffView();

        // 以內容雜湊比對是否為尚未看過的新進度（若內容相同、僅時間戳不同，則不彈假警報）
        const currentHash = contentHash(latestCloudContent);
        const seenHash = getSeenHash(filename);
        const lastAck = localStorage.getItem("ack_cloud_" + filename);
        const latestRound = extractLatestRounds(latestCloudContent, 1)[0];

        if (options.skipAlertCheck) {
          markSeen(filename, latestCloudContent);
        } else if (seenHash === currentHash) {
          // 內容與本機上次看過／送出的完全相同，靜默略過
        } else if (
          latestCloudAuthor === getCurrentAuthor() ||
          latestCloudAuthor === "本機同步" ||
          (lastAck && lastAck === latestCloudUpdatedAt)
        ) {
          markSeen(filename, latestCloudContent);
        } else if (latestCloudUpdatedAt) {
          triggerCloudAlert({
            filename,
            author: latestCloudAuthor,
            updatedAt: latestCloudUpdatedAt,
            isRealtime: false,
            summaryText: latestRound ? `最新段落：${latestRound.heading}` : "",
            content: latestCloudContent
          });
        }
        return;
      }
    } catch (e) {
      console.warn("尚未有該檔雲端草稿：", e);
    }
  }

  // 若無雲端資料，以預設或本地草稿呈現
  renderContent(`# ${filename}\n\n（尚無文字或初次載入）`);
}

// 渲染 Markdown
function renderContent(rawText) {
  // 處理簡易 wikilink [[text]]，若指向主線章節（如 [[創作/fiction/Green & Umin/6#1249 User]]）則提供點擊直接跳轉！
  let processed = rawText.replace(/\[\[(.*?)\]\]/g, (match, p1) => {
    const parts = p1.split("|");
    const target = parts[0].trim();
    const label = (parts[1] || parts[0]).trim();
    const chMatch = target.match(/(?:^|\/)(\d+)(?:#.*)?$/);
    if (chMatch) {
      const targetFile = `${chMatch[1]}.md`;
      return `<a href="#" class="wikilink-jump" data-target-file="${targetFile}">🔗 ${label}</a>`;
    }
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
}

// 3. 事件監聽
function setupEventListeners() {
  // 頂部身分切換器（記憶於本機 localStorage）
  if (authorRoleSelect) {
    authorRoleSelect.addEventListener("change", (e) => {
      localStorage.setItem("green_umin_author_role", e.target.value);
    });
  }

  // 內文 wikilink 點擊跳轉章節（例如點 5.md 末尾的移駕 6#1249 User）
  if (markdownRender) {
    markdownRender.addEventListener("click", (e) => {
      const link = e.target.closest(".wikilink-jump");
      if (link && link.dataset.targetFile) {
        e.preventDefault();
        const targetFile = link.dataset.targetFile;
        const targetLi = document.querySelector(`.file-list li[data-file="${targetFile}"]`);
        if (targetLi) updateActiveFile(targetLi);
        loadDocument(targetFile);
      }
    });
  }

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

  // 輔助：根據 roundEditMode 初始化右上角輕量回合或設定筆記編輯區
  function setupRoundEditorByMode(forceMode = null) {
    const baseContent = latestCloudContent || "";
    const isStoryChapter = currentFile.endsWith(".md") && /^\d+\.md$/.test(currentFile);

    // 設定集 / 附錄筆記編輯模式
    if (!isStoryChapter) {
      roundEditMode = "note_edit";
      if (newRoundTitle) {
        newRoundTitle.textContent = `✏️ 編輯設定筆記（${currentFile}）`;
      }
      if (btnSwitchRoundMode) {
        btnSwitchRoundMode.style.display = "none";
      }
      if (btnSubmitRound) {
        btnSubmitRound.textContent = "送出修改至雲端";
      }
      if (newRoundTextarea) {
        newRoundTextarea.placeholder = `在此編輯 ${currentFile} 內容...`;
        newRoundTextarea.value = baseContent;
      }
      if (newRoundPreview && newRoundTextarea) {
        newRoundPreview.innerHTML = md.render(newRoundTextarea.value);
        newRoundTextarea.focus();
        newRoundTextarea.selectionStart = 0;
        newRoundTextarea.selectionEnd = 0;
      }
      return;
    }

    // 主線故事章節（回合模式）
    if (btnSwitchRoundMode) {
      btnSwitchRoundMode.style.display = "inline-block";
    }
    if (btnSubmitRound) {
      btnSubmitRound.textContent = "送出回合至雲端";
    }

    const latestRounds = extractLatestRounds(baseContent, 1);
    const lastRound = latestRounds[0];

    // 判斷最後一個 H2 是否已經是 User 回合（若是，代表 GM 還沒回覆，預設應該是「補充當前回合」而非跳下一年度！）
    const isLastRoundUser = lastRound && /User/i.test(lastRound.heading);

    if (forceMode) {
      roundEditMode = forceMode;
    } else {
      roundEditMode = isLastRoundUser ? "append_current" : "new_next";
    }

    // 計算若要開新回合時的標題
    const yearMatches = [...baseContent.matchAll(/##\s*(\d{4})\s*(User|GM)/gi)];
    let nextTargetHeading = "## User 1";
    if (yearMatches.length > 0) {
      const last = yearMatches[yearMatches.length - 1];
      const lastYear = parseInt(last[1], 10);
      const lastRole = last[2].toUpperCase();
      // 若上一節是 GM（如 1248 GM），則新 User 回合是 1249 User；若上一節是 1249 User 而強制開下一回合，則是 1250 User
      const nextYear = lastRole === "GM" ? lastYear + 1 : lastYear + 1;
      nextTargetHeading = `## ${nextYear} User`;
    } else {
      const matches = [...baseContent.matchAll(/##\s*User\s*(\d+)/gi)];
      if (matches.length > 0) {
        const nextNum = parseInt(matches[matches.length - 1][1], 10) + 1;
        nextTargetHeading = `## User ${nextNum}`;
      }
    }

    if (roundEditMode === "append_current" && lastRound) {
      if (newRoundTitle) {
        newRoundTitle.textContent = `✏️ 補充當前回合（${lastRound.heading}）`;
      }
      if (btnSwitchRoundMode) {
        btnSwitchRoundMode.textContent = `➕ 改開下一回合 (${nextTargetHeading})`;
      }
      if (newRoundTextarea) {
        newRoundTextarea.value = lastRound.fullText + "\n";
      }
    } else {
      if (newRoundTitle) {
        newRoundTitle.textContent = `➕ 開啟全新回合（${nextTargetHeading}）`;
      }
      if (btnSwitchRoundMode) {
        btnSwitchRoundMode.textContent = lastRound
          ? `✏️ 改為補充當前回合 (${lastRound.heading})`
          : "✏️ 補充當前回合";
      }
      const savedRoundDraft = localStorage.getItem("new_round_" + currentFile);
      if (newRoundTextarea) {
        newRoundTextarea.value = savedRoundDraft || `${nextTargetHeading}\n\n`;
      }
    }

    if (newRoundPreview && newRoundTextarea) {
      newRoundPreview.innerHTML = md.render(newRoundTextarea.value);
      newRoundTextarea.focus();
      newRoundTextarea.selectionStart = newRoundTextarea.value.length;
      newRoundTextarea.selectionEnd = newRoundTextarea.value.length;
    }
  }

  // 新增回合 / 編輯筆記：全篇縮成左半，右半出現編輯區；再按一次可收合
  btnNewRound.addEventListener("click", () => {
    if (newRoundSide.style.display === "flex") {
      closeNewRoundSide();
      return;
    }
    newRoundSide.style.display = "flex";
    btnNewRound.classList.add("btn-active");
    setupRoundEditorByMode(null);
    // 左半全篇自動捲到最新處，方便對照
    setTimeout(() => {
      viewPanel.scrollTop = viewPanel.scrollHeight;
    }, 60);
  });

  if (btnSwitchRoundMode) {
    btnSwitchRoundMode.addEventListener("click", () => {
      const nextMode = roundEditMode === "append_current" ? "new_next" : "append_current";
      setupRoundEditorByMode(nextMode);
    });
  }

  // 新回合編輯打字事件
  if (newRoundTextarea) {
    newRoundTextarea.addEventListener("input", () => {
      const text = newRoundTextarea.value;
      if (newRoundPreview) {
        newRoundPreview.innerHTML = md.render(text);
      }
      if (roundEditMode === "new_next") {
        clearTimeout(newRoundDraftTimer);
        newRoundDraftTimer = setTimeout(() => {
          localStorage.setItem("new_round_" + currentFile, text);
        }, 400);
      }
    });
  }

  if (btnCancelRound) {
    btnCancelRound.addEventListener("click", closeNewRoundSide);
  }

  if (btnSubmitRound) {
    btnSubmitRound.addEventListener("click", async () => {
      const newRoundText = newRoundTextarea.value.trim();
      if (!newRoundText) return alert("內容不可為空！");
      if (!supabaseClient) return alert("Supabase 尚未連線！");

      const authorName = getCurrentAuthor();
      let modeDesc = "附加全新回合";
      if (roundEditMode === "note_edit") {
        modeDesc = "更新整篇筆記";
      } else if (roundEditMode === "append_current") {
        modeDesc = "更新當前回合";
      }

      if (!confirm(`確定要以「${authorName}」身分送出（${modeDesc}）至雲端嗎？`)) return;

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

        let mergedContent = "";
        if (roundEditMode === "note_edit") {
          mergedContent = newRoundText;
        } else if (roundEditMode === "append_current") {
          const latestRounds = extractLatestRounds(baseContent, 1);
          const lastRound = latestRounds[0];
          if (lastRound && lastRound.startIndex >= 0) {
            const prefix = baseContent.slice(0, lastRound.startIndex).trimEnd();
            mergedContent = prefix ? prefix + "\n\n" + newRoundText + "\n" : newRoundText + "\n";
          } else {
            mergedContent = newRoundText + "\n";
          }
        } else {
          mergedContent = baseContent.trim() + "\n\n" + newRoundText + "\n";
        }

        const nowIso = new Date().toISOString();
        const { error } = await supabaseClient
          .from("green_umin_drafts")
          .upsert({
            id: currentFile,
            content: mergedContent,
            author: authorName,
            updated_at: nowIso
          });

        if (error) throw error;

        const successDesc = roundEditMode === "note_edit" ? `成功更新《${currentFile}》至雲端！` : `成功送出至雲端！`;
        alert(`🎉 已以「${authorName}」身分${successDesc}`);
        localStorage.removeItem("new_round_" + currentFile);
        localStorage.setItem("ack_cloud_" + currentFile, nowIso);
        markSeen(currentFile, mergedContent);
        latestCloudContent = mergedContent;
        latestCloudAuthor = authorName;
        latestCloudUpdatedAt = nowIso;
        renderContent(mergedContent);

        closeNewRoundSide();

        setTimeout(() => {
          viewPanel.scrollTop = viewPanel.scrollHeight;
        }, 100);
      } catch (err) {
        alert("送出失敗：" + err.message);
      } finally {
        btnSubmitRound.disabled = false;
        btnSubmitRound.textContent = "送出回合至雲端";
      }
    });
  }

  // 頂部警示橫幅按鈕事件（若警示的是別的檔案，先自動切換載入該檔案！）
  if (btnAlertViewDiff) {
    btnAlertViewDiff.addEventListener("click", async () => {
      await ensureAlertFileLoaded();
      adminPanel.style.display = "block";
      currentDiffMode = "smart";
      updateDiffTabButtons();
      await updateDiffView();
      adminPanel.scrollIntoView({ behavior: "smooth" });
    });
  }

  if (btnAlertJumpBottom) {
    btnAlertJumpBottom.addEventListener("click", async () => {
      await ensureAlertFileLoaded();
      setTimeout(() => {
        viewPanel.scrollTo({ top: viewPanel.scrollHeight, behavior: "smooth" });
      }, 60);
    });
  }

  if (btnAlertCopyLatest) {
    btnAlertCopyLatest.addEventListener("click", async () => {
      await ensureAlertFileLoaded();
      copyLatestRoundToClipboard(btnAlertCopyLatest);
    });
  }

  if (btnAlertDismiss) {
    btnAlertDismiss.addEventListener("click", () => {
      dismissCloudAlert();
    });
  }

  // 管理端面板切換
  btnToggleAdmin.addEventListener("click", async () => {
    const isOpening = adminPanel.style.display === "none";
    adminPanel.style.display = isOpening ? "block" : "none";
    if (isOpening) {
      await updateDiffView();
    }
  });
  btnCloseAdmin.addEventListener("click", () => {
    adminPanel.style.display = "none";
  });

  // Diff 檢視模式切換
  if (btnDiffModeSmart) {
    btnDiffModeSmart.addEventListener("click", () => {
      currentDiffMode = "smart";
      updateDiffTabButtons();
      updateDiffView();
    });
  }
  if (btnDiffModeRounds) {
    btnDiffModeRounds.addEventListener("click", () => {
      currentDiffMode = "rounds";
      updateDiffTabButtons();
      updateDiffView();
    });
  }
  if (btnDiffModeTail) {
    btnDiffModeTail.addEventListener("click", () => {
      currentDiffMode = "tail";
      updateDiffTabButtons();
      updateDiffView();
    });
  }

  if (btnCopyLatestRound) {
    btnCopyLatestRound.addEventListener("click", () => {
      copyLatestRoundToClipboard(btnCopyLatestRound);
    });
  }

  if (btnDownloadCloudMd) {
    btnDownloadCloudMd.addEventListener("click", () => {
      if (!latestCloudContent) return alert("尚無雲端內容可下載！");
      const blob = new Blob([latestCloudContent], { type: "text/markdown;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = currentFile;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      markSeen(currentFile, latestCloudContent);
      dismissCloudAlert();
    });
  }

  // 本機資料夾選擇：支援 Chrome File System Access API，並自動降級支援 Zen / Firefox webkitdirectory
  btnSelectDir.addEventListener("click", async () => {
    if (window.showDirectoryPicker) {
      try {
        localDirHandle = await window.showDirectoryPicker({ mode: "readwrite" });
        selectedDirName.textContent = `✅ 已掛載本機目錄（可直寫）：${localDirHandle.name}`;
        selectedDirName.style.color = "#2b7a78";
        btnWriteVault.disabled = !latestCloudContent;
        if (btnSyncAllLocal) btnSyncAllLocal.disabled = false;
        await updateDiffView();
      } catch (err) {
        if (err.name !== "AbortError") {
          alert("授權失敗：" + err.message);
        }
      }
    } else if (fallbackDirInput) {
      // Zen / Firefox 瀏覽器：使用標準資料夾讀取器進行本機比對與全量上傳
      fallbackDirInput.click();
    } else {
      alert("您的瀏覽器不支援資料夾選取功能！");
    }
  });

  if (fallbackDirInput) {
    fallbackDirInput.addEventListener("change", async (e) => {
      const files = Array.from(e.target.files || []);
      if (files.length === 0) return;
      localFallbackFiles.clear();
      let mdCount = 0;
      for (const file of files) {
        if (file.name.endsWith(".md")) {
          const text = await file.text();
          localFallbackFiles.set(file.name, text);
          mdCount++;
        }
      }
      const folderName = files[0].webkitRelativePath
        ? files[0].webkitRelativePath.split("/")[0]
        : "本機資料夾";
      selectedDirName.textContent = `✅ 已載入本機目錄（Zen/Firefox 比對模式）：${folderName} (${mdCount} 個 .md 檔)`;
      selectedDirName.style.color = "#2b7a78";
      if (btnSyncAllLocal) btnSyncAllLocal.disabled = mdCount === 0;
      await updateDiffView();
    });
  }

  // 一鍵推送本機所有 Markdown 至雲端（智慧差異上傳：只上傳內容真正有變的檔案，避免刷動時間戳觸發假通知！）
  if (btnSyncAllLocal) {
    btnSyncAllLocal.addEventListener("click", async () => {
      if (!localDirHandle && localFallbackFiles.size === 0) return alert("請先選擇本機資料夾！");
      if (!supabaseClient) return alert("Supabase 尚未連線！");
      if (!confirm("確定要將本機有變更的 .md 檔案推送到雲端 Supabase 嗎？（內容完全未變的檔案將自動跳過）")) return;

      btnSyncAllLocal.disabled = true;
      syncAllStatus.textContent = "比對雲端差異並同步中...";

      try {
        // 先撈取雲端現有各檔的內容雜湊，只推送有差異的檔案
        const { data: cloudRows } = await supabaseClient
          .from("green_umin_drafts")
          .select("id, content");
        const cloudHashMap = new Map();
        if (cloudRows) {
          cloudRows.forEach((r) => cloudHashMap.set(r.id, contentHash(r.content || "")));
        }

        const localEntries = [];
        if (localDirHandle) {
          for await (const entry of localDirHandle.values()) {
            if (entry.kind === "file" && entry.name.endsWith(".md")) {
              const file = await entry.getFile();
              const text = await file.text();
              localEntries.push([entry.name, text]);
            }
          }
        } else {
          for (const [name, text] of localFallbackFiles.entries()) {
            localEntries.push([name, text]);
          }
        }

        let updatedCount = 0;
        let skippedCount = 0;
        const authorName = getCurrentAuthor();
        for (const [name, text] of localEntries) {
          const localHash = contentHash(text);
          if (cloudHashMap.get(name) === localHash) {
            skippedCount++;
            markSeen(name, text);
            continue;
          }
          await supabaseClient.from("green_umin_drafts").upsert({
            id: name,
            content: text,
            author: authorName,
            updated_at: new Date().toISOString()
          });
          markSeen(name, text);
          updatedCount++;
        }

        syncAllStatus.textContent = `同步完成：更新 ${updatedCount} 個有變更的檔案（略過 ${skippedCount} 個未變更檔）！`;
        alert(`同步完成！\n・實際更新上傳：${updatedCount} 個檔案\n・內容相同自動略過：${skippedCount} 個檔案`);
        await refreshChapterListFromCloud(false);
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
    if (!localDirHandle) return alert("請先在支援 File System Access API 的瀏覽器選擇本機資料夾，或使用右側「複製最新回合」／「下載最新 .md 檔」！");
    if (!latestCloudContent) return alert("尚無雲端內容可寫入！");
    await writeToLocalVault(currentFile, latestCloudContent);
  });

  autoWriteToggle.addEventListener("change", (e) => {
    autoWriteLocal = e.target.checked;
  });
}

function updateDiffTabButtons() {
  [
    [btnDiffModeSmart, "smart"],
    [btnDiffModeRounds, "rounds"],
    [btnDiffModeTail, "tail"]
  ].forEach(([btn, mode]) => {
    if (!btn) return;
    if (currentDiffMode === mode) btn.classList.add("btn-active");
    else btn.classList.remove("btn-active");
  });
}

// 萃取檔案末尾最後 N 個 H2 回合段落
function extractLatestRounds(text, count = 2) {
  if (!text) return [];
  const regex = /^##\s+([^\n#]+)$/gm;
  const matches = [...text.matchAll(regex)];
  if (matches.length === 0) {
    return [{ heading: "檔案末尾內容", fullText: text.slice(-1500), startIndex: Math.max(0, text.length - 1500) }];
  }
  const selected = matches.slice(-count);
  return selected.map((m, idx) => {
    const startIdx = m.index;
    const nextMatch = selected[idx + 1];
    const endIdx = nextMatch ? nextMatch.index : text.length;
    return {
      heading: "## " + m[1].trim(),
      fullText: text.slice(startIdx, endIdx).trim(),
      startIndex: startIdx
    };
  });
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// 取得本機對應檔案內容（若已掛載）
async function getLocalFileText(filename) {
  if (localDirHandle) {
    try {
      const fh = await localDirHandle.getFileHandle(filename);
      const file = await fh.getFile();
      return await file.text();
    } catch (e) {
      return null;
    }
  }
  if (localFallbackFiles.has(filename)) {
    return localFallbackFiles.get(filename);
  }
  return null;
}

// 計算高速行級別 Diff HTML（專注變動區塊與檔案尾端新回合）
function computeLineDiffHtml(oldText, newText, contextLines = 5) {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");

  let prefix = 0;
  const minLen = Math.min(oldLines.length, newLines.length);
  while (prefix < minLen && oldLines[prefix] === newLines[prefix]) {
    prefix++;
  }

  let suffix = 0;
  while (
    suffix < minLen - prefix &&
    oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]
  ) {
    suffix++;
  }

  const oldChanged = oldLines.slice(prefix, oldLines.length - suffix);
  const newChanged = newLines.slice(prefix, newLines.length - suffix);

  if (oldChanged.length === 0 && newChanged.length === 0) {
    return { hasDiff: false, addedCount: 0, deletedCount: 0, html: "" };
  }

  const ctxStart = Math.max(0, prefix - contextLines);
  const beforeCtx = newLines.slice(ctxStart, prefix);
  const afterCtxStart = newLines.length - suffix;
  const afterCtx = newLines.slice(afterCtxStart, Math.min(newLines.length, afterCtxStart + contextLines));

  let htmlParts = [];
  htmlParts.push(
    `<span class="diff-hunk-header">@@ 第 ${prefix + 1} 行起（刪減 ${oldChanged.length} 行 ／ 新增 ${newChanged.length} 行）@@</span>`
  );

  beforeCtx.forEach((line) => {
    htmlParts.push(`<span class="diff-line-ctx">  ${escapeHtml(line)}</span>`);
  });

  oldChanged.forEach((line) => {
    htmlParts.push(`<span class="diff-line-del">- ${escapeHtml(line)}</span>`);
  });

  newChanged.forEach((line) => {
    htmlParts.push(`<span class="diff-line-add">+ ${escapeHtml(line)}</span>`);
  });

  afterCtx.forEach((line) => {
    htmlParts.push(`<span class="diff-line-ctx">  ${escapeHtml(line)}</span>`);
  });

  return {
    hasDiff: true,
    addedCount: newChanged.length,
    deletedCount: oldChanged.length,
    html: htmlParts.join("")
  };
}

// 更新管理端 Diff 視圖（不再只看開頭，直擊最新回合與變更！）
async function updateDiffView() {
  if (!diffDisplay) return;
  if (!latestCloudContent) {
    diffDisplay.textContent = "尚無雲端內容可檢視";
    return;
  }

  const timeStr = formatLocalTime(latestCloudUpdatedAt);
  const localText = await getLocalFileText(currentFile);
  const latestRounds = extractLatestRounds(latestCloudContent, 2);
  const lastRound = latestRounds[latestRounds.length - 1];

  if (currentDiffMode === "rounds") {
    if (diffSummaryBar) {
      diffSummaryBar.textContent = `📌 顯示《${currentFile}》最末尾 ${latestRounds.length} 個回合全文（最後更新：${latestCloudAuthor} @ ${timeStr}）`;
    }
    const html = latestRounds
      .map(
        (r, i) =>
          `<span class="diff-hunk-header">【倒數第 ${latestRounds.length - i} 回合】${escapeHtml(r.heading)}（共 ${r.fullText.length} 字）</span>` +
          r.fullText
            .split("\n")
            .map((line) =>
              i === latestRounds.length - 1
                ? `<span class="diff-line-add">+ ${escapeHtml(line)}</span>`
                : `<span class="diff-line-ctx">  ${escapeHtml(line)}</span>`
            )
            .join("")
      )
      .join("\n");
    diffDisplay.innerHTML = html;
    return;
  }

  if (currentDiffMode === "tail") {
    const tailLen = 2000;
    const sliceText = latestCloudContent.slice(-tailLen);
    if (diffSummaryBar) {
      diffSummaryBar.textContent = `📜 顯示《${currentFile}》檔案末尾最後 ${sliceText.length.toLocaleString()} 字（總長 ${latestCloudContent.length.toLocaleString()} 字）`;
    }
    diffDisplay.textContent = (latestCloudContent.length > tailLen ? "... (前略) ...\n\n" : "") + sliceText;
    diffDisplay.scrollTop = diffDisplay.scrollHeight;
    return;
  }

  // 預設：currentDiffMode === "smart"（智慧變更比對）
  if (localText !== null) {
    // 有掛載本機檔案：進行 100% 精準「本機 Vault vs 雲端」比對
    const diffRes = computeLineDiffHtml(localText, latestCloudContent, 6);
    if (!diffRes.hasDiff) {
      if (diffSummaryBar) {
        diffSummaryBar.textContent = `✅ 本機《${currentFile}》與雲端版本完全一致！（以下顯示最新一回合 ${lastRound ? lastRound.heading : ""} 供確認）`;
      }
      diffDisplay.innerHTML =
        `<span class="diff-hunk-header">✅ 本機與雲端 0 差異｜最新回合預覽：${escapeHtml(lastRound ? lastRound.heading : "")}</span>` +
        (lastRound ? lastRound.fullText.split("\n").map((l) => `<span class="diff-line-ctx">  ${escapeHtml(l)}</span>`).join("") : "");
    } else {
      const charDiff = latestCloudContent.length - localText.length;
      const charSign = charDiff >= 0 ? `+${charDiff}` : `${charDiff}`;
      if (diffSummaryBar) {
        diffSummaryBar.textContent = `🔥 偵測到雲端與本機差異！新增 ${diffRes.addedCount} 行、刪減 ${diffRes.deletedCount} 行（字數差：${charSign} 字｜作者：${latestCloudAuthor} @ ${timeStr}）`;
      }
      diffDisplay.innerHTML = diffRes.html;
    }
    return;
  }

  // 若尚未掛載本機資料夾，但有 previousCloudContent（Realtime 推播前後比對）
  if (previousCloudContent && previousCloudContent !== latestCloudContent) {
    const diffRes = computeLineDiffHtml(previousCloudContent, latestCloudContent, 6);
    if (diffSummaryBar) {
      diffSummaryBar.textContent = `🔔 即時推播變更比對：新增 ${diffRes.addedCount} 行、刪減 ${diffRes.deletedCount} 行（作者：${latestCloudAuthor} @ ${timeStr}）`;
    }
    diffDisplay.innerHTML = diffRes.html;
    return;
  }

  // 若尚未掛載本機資料夾且為初次打開網頁：自動將「最新一回合」作為新增高亮區塊展示，並附上上一回合末尾作為上下文！
  if (lastRound) {
    const beforeLastRound = latestCloudContent.slice(0, lastRound.startIndex).trimEnd();
    const diffRes = computeLineDiffHtml(beforeLastRound, latestCloudContent, 8);
    if (diffSummaryBar) {
      diffSummaryBar.textContent = `✨ 雲端最新一回合直擊：${lastRound.heading}（作者：${latestCloudAuthor} @ ${timeStr}，本回合共 ${lastRound.fullText.length} 字）｜提示：點上方「1. 選擇本機資料夾」可與本機檔案逐行比對`;
    }
    diffDisplay.innerHTML = diffRes.html;
  }
}

// 一鍵複製最新一回合文字到剪貼簿
async function copyLatestRoundToClipboard(btnEl) {
  if (!latestCloudContent) return alert("尚無雲端內容！");
  const rounds = extractLatestRounds(latestCloudContent, 1);
  if (rounds.length === 0) return;
  const latestRound = rounds[0];
  try {
    await navigator.clipboard.writeText("\n" + latestRound.fullText + "\n");
    const origText = btnEl ? btnEl.textContent : "";
    if (btnEl) {
      btnEl.textContent = `✅ 已複製 ${latestRound.heading}！`;
      setTimeout(() => {
        btnEl.textContent = origText;
      }, 2500);
    }
    dismissCloudAlert();
  } catch (e) {
    alert("複製失敗，請手動選取複製：" + e.message);
  }
}

// 輔助：寫入本機檔案
async function writeToLocalVault(filename, content) {
  try {
    const fileHandle = await localDirHandle.getFileHandle(filename, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(content);
    await writable.close();
    dismissCloudAlert();
    await updateDiffView();
    if (diffSummaryBar) {
      diffSummaryBar.textContent = `✅ [${new Date().toLocaleTimeString()}] 已成功寫入本機 Vault: ${filename}！Obsidian 已同步變更。`;
    }
  } catch (err) {
    console.error("本機寫入失敗：", err);
    alert("本機寫入失敗：" + err.message);
  }
}

function closeNewRoundSide() {
  if (newRoundSide) newRoundSide.style.display = "none";
  btnNewRound.classList.remove("btn-active");
}

function updateActiveFile(targetLi) {
  document.querySelectorAll(".file-list li").forEach((li) => li.classList.remove("active"));
  targetLi.classList.add("active");
}
