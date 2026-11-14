(() => {
  const $ = (s) => document.querySelector(s);
  let fileQueue = [];
  let repoConfig = JSON.parse(localStorage.getItem("gh_config") || "null");

  const modal = $("#modal"), tokenInput = $("#token-input"), repoInput = $("#repo-input");
  const authLevel = $("#auth-level"), btnLogin = $("#btn-login"), btnLogout = $("#btn-logout");
  const uploadSection = $("#upload-section"), list = $("#list");

  function checkAuth() {
    if (repoConfig && repoConfig.token && repoConfig.repo) {
      authLevel.textContent = "ROOT";
      authLevel.className = "blink";
      btnLogin.classList.add("hidden");
      btnLogout.classList.remove("hidden");
      uploadSection.classList.remove("hidden");
      repoInput.value = repoConfig.repo;
    } else {
      authLevel.textContent = "GUEST";
      authLevel.className = "text-red";
      btnLogin.classList.remove("hidden");
      btnLogout.classList.add("hidden");
      uploadSection.classList.add("hidden");
      repoConfig = null;
    }
    loadFiles();
  }

  btnLogin.onclick = () => modal.classList.remove("hidden");
  $("#btn-cancel").onclick = () => modal.classList.add("hidden");
  btnLogout.onclick = () => { localStorage.removeItem("gh_config"); checkAuth(); };
  
  $("#btn-submit").onclick = () => {
    const token = tokenInput.value.trim();
    const repo = repoInput.value.trim();
    if (!token || !repo.includes("/")) return alert("[!] 格式错误：需输入 Token 及 Owner/Repo");
    repoConfig = { token, repo };
    localStorage.setItem("gh_config", JSON.stringify(repoConfig));
    modal.classList.add("hidden");
    checkAuth();
  };

  async function loadFiles() {
    if (!repoConfig || !repoConfig.repo) {
      list.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-dim)">[ 未配置目标仓库，请先 sudo_login 并输入 owner/repo ]</div>';
      return;
    }
    
    list.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-dim)">[ 正在拉取数据... ]</div>';
    try {
      const res = await fetch(`https://api.github.com/repos/${repoConfig.repo}/releases`);
      const releases = await res.json();
      
      const kw = $("#q").value.trim().toLowerCase();
      list.innerHTML = "";

      let count = 0;
      for (const rel of releases) {
        for (const asset of rel.assets) {
          if (kw && !asset.name.toLowerCase().includes(kw) && !(rel.body||"").toLowerCase().includes(kw)) continue;
          
          count++;
          const el = document.createElement("div");
          el.className = "file-item";
          el.innerHTML = `
            <div>
              <span class="name">${escapeHtml(asset.name)}</span>
              <span class="tag">${escapeHtml(rel.tag_name)}</span>
              ${rel.body ? `<div class="desc">> ${escapeHtml(rel.body)}</div>` : ''}
            </div>
            <span>${(asset.size / 1024 / 1024).toFixed(1)} MB</span>
            <div>
              <a href="${asset.browser_download_url}" class="btn">GET</a>
              ${repoConfig.token ? `<button class="btn danger btn-del" data-id="${rel.id}">DEL</button>` : ''}
            </div>
          `;
          list.appendChild(el);
        }
      }

      if (count === 0) list.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-dim)">[ NULL ] 无数据</div>';
      bindDeleteBtns();
    } catch (e) {
      list.innerHTML = `<div style="padding:20px;text-align:center;color:var(--danger)">[ ERR ] 拉取失败，检查仓库名是否正确 (${e.message})</div>`;
    }
  }

  function bindDeleteBtns() {
    document.querySelectorAll(".btn-del").forEach(btn => {
      btn.onclick = async () => {
        if (!confirm("[!] 警告: 确认彻底删除该 Release？不可逆操作。")) return;
        const id = btn.dataset.id;
        await fetch(`https://api.github.com/repos/${repoConfig.repo}/releases/${id}`, {
          method: "DELETE",
          headers: { "Authorization": `token ${repoConfig.token}` }
        });
        loadFiles();
      };
    });
  }

  const drop = $("#drop"), fileInput = $("#file");
  drop.onclick = () => fileInput.click();
  fileInput.onchange = () => { addFiles(Array.from(fileInput.files)); fileInput.value = ""; };
  ["dragenter","dragover"].forEach(e => drop.addEventListener(e, ev => { ev.preventDefault(); drop.classList.add("over"); }));
  ["dragleave","drop"].forEach(e => drop.addEventListener(e, ev => { ev.preventDefault(); drop.classList.remove("over"); }));
  drop.addEventListener("drop", ev => addFiles(Array.from(ev.dataTransfer.files)));

  function addFiles(files) {
    if (!repoConfig || !repoConfig.token) return alert("[!] 请先登录");
    for (const f of files) {
      if (f.size > 2 * 1024 * 1024 * 1024) { alert(`[!] 超出 GitHub 限制 (2GB): ${f.name}`); continue; }
      
      const id = Math.random().toString(36).slice(2);
      const el = document.createElement("div");
      el.className = "q-item";
      el.id = "q-" + id;
      el.innerHTML = `
        <div class="q-info"><span>${escapeHtml(f.name)}</span><span class="q-status">WAIT</span></div>
        <div class="q-bar">[          ] 0%</div>
      `;
      $("#queue").appendChild(el);
      startUpload(id, f);
    }
  }

  function updateBar(id, percent, status) {
    const el = document.getElementById("q-" + id);
    if (!el) return;
    el.querySelector(".q-status").textContent = status;
    const blocks = Math.floor(percent / 10);
    el.querySelector(".q-bar").textContent = "[" + "■".repeat(blocks) + " ".repeat(10 - blocks) + "] " + percent + "%";
  }

  async function startUpload(id, file) {
    const note = $("#note").value || "手动上传";
    const tag = "v" + Date.now();
    
    try {
      updateBar(id, 5, "CREATE_RELEASE");
      const relRes = await fetch(`https://api.github.com/repos/${repoConfig.repo}/releases`, {
        method: "POST",
        headers: { "Authorization": `token ${repoConfig.token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ tag_name: tag, name: file.name, body: note })
      });
      if (!relRes.ok) throw new Error("Release创建失败，检查 Token 权限 (需 repo 权限)");
      const rel = await relRes.json();

      updateBar(id, 20, "UPLOADING");
      const uploadUrl = rel.upload_url.replace("{?name,label}", `?name=${encodeURIComponent(file.name)}`);
      
      const xhr = new XMLHttpRequest();
      xhr.open("POST", uploadUrl);
      xhr.setRequestHeader("Authorization", `token ${repoConfig.token}`);
      xhr.setRequestHeader("Content-Type", "application/octet-stream");
      
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          const p = 20 + Math.floor((e.loaded / e.total) * 80);
          updateBar(id, p, "UPLOADING");
        }
      };
      
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          updateBar(id, 100, "✅ DONE");
          setTimeout(() => document.getElementById("q-"+id).remove(), 2000);
          loadFiles();
        } else {
          updateBar(id, 100, "❌ ERR");
          alert("[!] 附件上传失败，可能是网络问题或超出 2GB 限制");
        }
      };
      xhr.onerror = () => updateBar(id, 100, "❌ NET_ERR");
      xhr.send(file);

    } catch (e) {
      updateBar(id, 100, "❌ FAIL");
      alert(e.message);
    }
  }

  $("#btn-refresh").onclick = loadFiles;
  $("#q").addEventListener("keydown", e => { if (e.key === "Enter") loadFiles(); });
  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c])); }

  checkAuth();
})();
