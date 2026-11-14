(() => {
  const $ = (s) => document.querySelector(s);
  let repoConfig = JSON.parse(localStorage.getItem("gh_config") || "null");

  const modal = $("#modal"), tokenInput = $("#token-input"), repoInput = $("#repo-input");
  const authLevel = $("#auth-level"), btnLogin = $("#btn-login"), btnLogout = $("#btn-logout");
  const uploadSection = $("#upload-section"), list = $("#list");

  function checkAuth() {
    if (repoConfig && repoConfig.token && repoConfig.repo) {
      authLevel.textContent = "管理员";
      authLevel.className = "blink";
      btnLogin.classList.add("hidden");
      btnLogout.classList.remove("hidden");
      uploadSection.classList.remove("hidden");
      repoInput.value = repoConfig.repo;
    } else {
      authLevel.textContent = "访客";
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
    if (!token || !repo.includes("/")) return alert("[错误] 请填写正确的密钥和仓库名(如: ni6i/hack-node)");
    repoConfig = { token, repo };
    localStorage.setItem("gh_config", JSON.stringify(repoConfig));
    modal.classList.add("hidden");
    checkAuth();
  };

  async function loadFiles() {
    if (!repoConfig || !repoConfig.repo) {
      list.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-dim)">[ 请先登录管理员以加载数据 ]</div>';
      return;
    }
    
    list.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-dim)">[ 正在加载文件列表... ]</div>';
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
              ${rel.body ? `<div class="desc">> 备注: ${escapeHtml(rel.body)}</div>` : ''}
            </div>
            <span>${(asset.size / 1024 / 1024).toFixed(1)} MB</span>
            <div>
              <a href="${asset.browser_download_url}" class="btn">[ 下载 ]</a>
              ${repoConfig.token ? `<button class="btn danger btn-del" data-id="${rel.id}">[ 删除 ]</button>` : ''}
            </div>
          `;
          list.appendChild(el);
        }
      }

      if (count === 0) list.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-dim)">[ 暂无文件 ]</div>';
      bindDeleteBtns();
    } catch (e) {
      list.innerHTML = `<div style="padding:20px;text-align:center;color:var(--danger)">[ 加载失败 ] 请检查仓库名和密钥是否正确</div>`;
    }
  }

  function bindDeleteBtns() {
    document.querySelectorAll(".btn-del").forEach(btn => {
      btn.onclick = async () => {
        if (!confirm("[警告] 确定要永久删除这个文件吗？删除后无法恢复！")) return;
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
    if (!repoConfig || !repoConfig.token) return alert("[!] 请先登录管理员");
    for (const f of files) {
      if (f.size > 2 * 1024 * 1024 * 1024) { alert(`[错误] 文件 "${f.name}" 超出 2GB 限制`); continue; }
      
      const id = Math.random().toString(36).slice(2);
      const el = document.createElement("div");
      el.className = "q-item";
      el.id = "q-" + id;
      el.innerHTML = `
        <div class="q-info"><span>${escapeHtml(f.name)}</span><span class="q-status">等待上传</span></div>
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
    const note = $("#note").value || "无备注";
    const tag = "v" + Date.now();
    
    try {
      updateBar(id, 5, "创建记录中");
      const relRes = await fetch(`https://api.github.com/repos/${repoConfig.repo}/releases`, {
        method: "POST",
        headers: { "Authorization": `token ${repoConfig.token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ tag_name: tag, name: file.name, body: note })
      });
      if (!relRes.ok) throw new Error("权限不足，请检查 Token 是否勾选了 repo 权限");
      const rel = await relRes.json();

      updateBar(id, 20, "上传中");
      const uploadUrl = rel.upload_url.replace("{?name,label}", `?name=${encodeURIComponent(file.name)}`);
      
      const xhr = new XMLHttpRequest();
      xhr.open("POST", uploadUrl);
      xhr.setRequestHeader("Authorization", `token ${repoConfig.token}`);
      xhr.setRequestHeader("Content-Type", "application/octet-stream");
      
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          const p = 20 + Math.floor((e.loaded / e.total) * 80);
          updateBar(id, p, "上传中");
        }
      };
      
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          updateBar(id, 100, "✅ 上传成功");
          setTimeout(() => document.getElementById("q-"+id).remove(), 2000);
          loadFiles();
        } else {
          updateBar(id, 100, "❌ 失败");
          alert("[错误] 附件上传失败，可能是网络问题或超出限制");
        }
      };
      xhr.onerror = () => updateBar(id, 100, "❌ 网络错误");
      xhr.send(file);

    } catch (e) {
      updateBar(id, 100, "❌ 失败");
      alert(e.message);
    }
  }

  $("#btn-refresh").onclick = loadFiles;
  $("#q").addEventListener("keydown", e => { if (e.key === "Enter") loadFiles(); });
  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c])); }

  checkAuth();
})();
