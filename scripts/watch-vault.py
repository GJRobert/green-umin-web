#!/usr/bin/env python3
"""
Green & Umin Web - 本機 Vault 自動監聽與雲端自動同步腳本
功能：
1. 監聽本機目錄下的所有 .md 檔案（故事主線與設定筆記）。
2. 當檔案在 Obsidian 存檔時，自動比對內容雜湊，若有實質變更則自動上傳至 Supabase 雲端。
3. 支援定期反向偵測雲端是否有新進度（推播提醒）。
"""

import os
import sys
import time
import json
import hashlib
import datetime
import urllib.request
import urllib.error

SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://qofxozylnbgkfhcxikdp.supabase.co")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY", "sb_publishable_O8HGoBrik2nrccdap3IeRg_H6o5v7yj")
DEFAULT_VAULT_DIR = os.path.expanduser("~/NAS/Obsidian/Main/創作/fiction/Green & Umin")
VAULT_DIR = os.environ.get("VAULT_DIR", DEFAULT_VAULT_DIR)
AUTHOR_NAME = os.environ.get("AUTHOR_NAME", "阿爸")
CHECK_INTERVAL = float(os.environ.get("CHECK_INTERVAL", "2.0"))

def compute_hash(text: str) -> str:
    norm = text.replace("\r\n", "\n").strip()
    return hashlib.sha256(norm.encode("utf-8")).hexdigest()

def http_json_request(url: str, method: str = "GET", data: dict = None, headers: dict = None):
    req_headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json"
    }
    if headers:
        req_headers.update(headers)
    body = json.dumps(data).encode("utf-8") if data is not None else None
    req = urllib.request.Request(url, data=body, method=method, headers=req_headers)
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            content = resp.read().decode("utf-8")
            return json.loads(content) if content else None
    except urllib.error.HTTPError as e:
        err_msg = e.read().decode("utf-8", errors="ignore")
        raise RuntimeError(f"HTTP {e.code}: {err_msg}")

def upload_file_to_cloud(filename: str, content: str, author: str = AUTHOR_NAME):
    endpoint = f"{SUPABASE_URL}/rest/v1/green_umin_drafts"
    payload = {
        "id": filename,
        "content": content,
        "author": author,
        "updated_at": datetime.datetime.now(datetime.timezone.utc).isoformat()
    }
    http_json_request(endpoint, method="POST", data=payload, headers={"Prefer": "resolution=merge-duplicates"})

def fetch_cloud_hashes():
    endpoint = f"{SUPABASE_URL}/rest/v1/green_umin_drafts?select=id,content,author,updated_at"
    rows = http_json_request(endpoint, method="GET") or []
    return {r["id"]: {"hash": compute_hash(r.get("content", "")), "author": r.get("author", ""), "updated_at": r.get("updated_at", "")} for r in rows}

def main():
    vault_path = os.path.abspath(VAULT_DIR)
    if not os.path.exists(vault_path):
        print(f"❌ 錯誤：找不到監聽目錄：{vault_path}", file=sys.stderr)
        sys.exit(1)

    print("=" * 60)
    print("🌲 綠光與流求 Web 共筆 - 本機 Vault 自動同步監聽器")
    print(f"📁 監聽目錄: {vault_path}")
    print(f"👤 同步身分: {AUTHOR_NAME}")
    print(f"⏱️ 輪詢頻率: 每 {CHECK_INTERVAL} 秒")
    print("=" * 60)

    # 記錄本地狀態: filename -> (mtime, hash)
    local_state = {}
    
    # 初始掃描
    for fname in os.listdir(vault_path):
        if fname.endswith(".md") and not fname.startswith("."):
            fpath = os.path.join(vault_path, fname)
            try:
                mtime = os.path.getmtime(fpath)
                with open(fpath, "r", encoding="utf-8") as f:
                    content = f.read()
                local_state[fname] = {"mtime": mtime, "hash": compute_hash(content)}
            except Exception as e:
                print(f"⚠️ 讀取 {fname} 失敗: {e}")

    print(f"✅ 初始掃描完成，已追蹤 {len(local_state)} 個 Markdown 檔案。進入持續監聽模式...\n")

    cloud_check_counter = 0

    while True:
        try:
            time.sleep(CHECK_INTERVAL)
            cloud_check_counter += 1

            # 1. 檢查本機是否有檔案存檔修改
            current_files = [f for f in os.listdir(vault_path) if f.endswith(".md") and not f.startswith(".")]

            for fname in current_files:
                fpath = os.path.join(vault_path, fname)
                try:
                    mtime = os.path.getmtime(fpath)
                except OSError:
                    continue

                prev = local_state.get(fname)
                if prev is None or mtime != prev["mtime"]:
                    try:
                        with open(fpath, "r", encoding="utf-8") as f:
                            content = f.read()
                        current_hash = compute_hash(content)
                    except Exception as e:
                        continue

                    # 若內容真的改變，自動上傳至雲端
                    if prev is None or current_hash != prev["hash"]:
                        now_str = datetime.datetime.now().strftime("%H:%M:%S")
                        print(f"[{now_str}] 📝 偵測到本機存檔修改: {fname} ({len(content):,} 字)")
                        try:
                            upload_file_to_cloud(fname, content)
                            print(f"[{now_str}] 🚀 已自動同步至 Supabase 雲端！\n")
                            local_state[fname] = {"mtime": mtime, "hash": current_hash}
                        except Exception as e:
                            print(f"[{now_str}] ❌ 自動上傳失敗: {e}\n")
                    else:
                        local_state[fname] = {"mtime": mtime, "hash": current_hash}

            # 2. 每 15 秒檢查一次雲端是否有他人上傳的更新
            if cloud_check_counter >= int(15 / CHECK_INTERVAL):
                cloud_check_counter = 0
                try:
                    cloud_data = fetch_cloud_hashes()
                    for cid, cinfo in cloud_data.items():
                        # 若雲端作者不是自己，且本地 hash 與雲端不同，提醒本地有未抓取的新進度
                        if cinfo["author"] and cinfo["author"] != AUTHOR_NAME and cinfo["author"] != "本機同步":
                            loc = local_state.get(cid)
                            if loc and loc["hash"] != cinfo["hash"]:
                                now_str = datetime.datetime.now().strftime("%H:%M:%S")
                                print(f"[{now_str}] 🔔 提示：{cinfo['author']} 在雲端更新了《{cid}》（雲端較新，可由瀏覽器或本機確認）")
                except Exception:
                    pass

        except KeyboardInterrupt:
            print("\n👋 監聽器已停止運作。")
            break
        except Exception as e:
            print(f"⚠️ 循環發生未預期錯誤: {e}")
            time.sleep(3)

if __name__ == "__main__":
    main()
