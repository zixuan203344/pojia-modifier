const TOKEN = "__TOKEN__";
const VERSION = "__VERSION__";
const TARGETS = __TARGETS__;
const ACTIONS = __ACTIONS__;
const IS_WIN = __ISWIN__;

const selected = new Set(TARGETS.map(t => t[0]));
const opts = {mode: "inject", gitBash: false, ccguiOpen: false};
const ccguiComponents = () => {
  const plugin = $("ccgui-plugin").checked;
  const persona = $("ccgui-persona").checked;
  return plugin ? (persona ? "both" : "plugin") : (persona ? "persona" : "none");
};

const $ = id => document.getElementById(id);
const chipsEl = $("chips"), actsEl = $("acts"), acts2El = $("acts2"), outEl = $("out");
const stateEl = $("state"), stateText = $("state-text"), countEl = $("count");
const elapsedEl = $("elapsed"), consoleEl = $("console"), optsEl = $("opts");
const goBtn = $("go"), hintEl = $("hint");
const uBar = $("u-bar"), uText = $("u-text"), uGo = $("u-go"), uNo = $("u-no");
const resultEl = $("result"), rTitle = $("r-title"), rText = $("r-text"), rLog = $("r-log");
const uCheck = $("u-check"), uState = $("u-state"), uInstall = $("u-install");
const uProg = $("u-prog"), uFill = $("u-fill"), uPct = $("u-pct"), uLog = $("u-log");
const rScan = $("rescan"), scanTip = $("scan-tip");

/* 软件清单 */
TARGETS.forEach(([key, label]) => {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "row";
  b.dataset.key = key;
  b.setAttribute("aria-pressed", "true");
  b.innerHTML = `<span class="box"></span><span class="lbl">${label}</span>`
    + (key === "dsh" ? `<span class="badge">有选项</span>` : "")
    + `<span class="st" data-st="${key}"></span>`;
  b.onclick = () => {
    if (selected.has(key)) selected.delete(key); else selected.add(key);
    b.setAttribute("aria-pressed", selected.has(key));
    sync();
  };
  if (key === "ccgui"){
    const wrap = document.createElement("div");
    wrap.className = "row-options";
    const options = document.createElement("button");
    options.type = "button";
    options.id = "ccgui-options";
    options.className = "btn";
    options.textContent = "选项";
    options.setAttribute("aria-controls", "ccguiblock");
    options.setAttribute("aria-expanded", "false");
    options.onclick = () => {
      opts.ccguiOpen = !opts.ccguiOpen;
      sync();
    };
    wrap.append(b, options);
    chipsEl.appendChild(wrap);
  } else {
    chipsEl.appendChild(b);
  }
});

function sync(){
  countEl.textContent = `${selected.size}/${TARGETS.length}`;
  const on = selected.has("dsh");
  /* 没勾 DSH 就整块收起来 —— 留着压暗的控件只会让人问「为什么点不动」 */
  $("dshblock").hidden = !on;
  optsEl.querySelectorAll("input").forEach(el => el.disabled = !on);
  $("ccguiblock").hidden = !opts.ccguiOpen;
  $("ccgui-options").setAttribute("aria-expanded", opts.ccguiOpen);

  const n = selected.size;
  if (!n){
    hintEl.innerHTML = "还没勾选任何软件 —— 先在下面点一个。";
    goBtn.disabled = true;
  } else {
    hintEl.innerHTML = `已选 <b>${n}</b> 个软件 · 没装的会自动跳过 · 改错了随时能还原`;
    goBtn.disabled = busy;
  }
  paintSummary();
}

/* 右列底部的摘要：把「点下去会发生什么」提前写出来，不用等确认框。
   没勾 DSH 时那两行直接不显示，和上面整块的隐藏保持一致。 */
function paintSummary(){
  const n = selected.size, dsh = selected.has("dsh");
  $("s-soft").innerHTML = n
    ? `<b>${n}</b> 个${n === TARGETS.length ? "（全部）" : ""}`
    : `<b>未选</b> —— 先勾一个`;
  $("s-row-mode").hidden = !dsh;
  $("s-mode").textContent = opts.mode === "preset"
    ? "只加一个模式（不改官方文件）" : "改配置文件（所有模式生效）";
  $("s-row-shell").hidden = !dsh || !IS_WIN;
  $("s-shell").textContent = opts.gitBash
    ? "Git Bash（重启 DSH 后生效）" : "PowerShell（官方默认）";
  $("s-row-ccgui").hidden = !selected.has("ccgui");
  $("s-ccgui").textContent = ccguiSummary();
}
function ccguiSummary(){
  return {both: "插件、安装人格", plugin: "插件", persona: "安装人格", none: "跳过"}[ccguiComponents()];
}
$("ccgui-plugin").onchange = $("ccgui-persona").onchange = paintSummary;
$("all").onclick = () => {
  TARGETS.forEach(t => selected.add(t[0]));
  chipsEl.querySelectorAll(".row").forEach(c => c.setAttribute("aria-pressed", "true"));
  sync();
};
$("none").onclick = () => {
  selected.clear();
  chipsEl.querySelectorAll(".row").forEach(c => c.setAttribute("aria-pressed", "false"));
  sync();
};

/* ── 每行的现状 ──────────────────────────────────────────────
   四档：已破甲 / 部分破甲 / 未破甲 / 未安装。
   以前点「先检测一下」会把人拽到运行记录页去数行；现在跑完就地把每行标出来，
   日志留在那边给想深看的人。判据来自核心的护照戳记 —— 客户端升级把注入过的
   文件换回出厂版时，行上会从「已破甲」掉成「部分破甲」或「未破甲」。 */
let scanMap = {};
let scanning = false;

const ST_TEXT = {full: "已破甲", partial: "部分破甲", clean: "未破甲", none: "未安装"};

function paintScan(rows){
  const map = {};
  (rows || []).forEach(r => { if (r && r.key) map[r.key] = r; });
  scanMap = map;
  chipsEl.querySelectorAll(".row").forEach(row => {
    const key = row.dataset.key;
    const el = row.querySelector(".st");
    if (!el) return;
    const r = map[key];
    if (!r){
      el.textContent = "";
      delete el.dataset.state;
      el.removeAttribute("title");
      return;
    }
    /* stale 只跟「已破甲」搭配：上一版写的，文件还是那批，只是版本旧了 */
    el.textContent = (ST_TEXT[r.state] || r.label || "")
      + (r.stale && r.state === "full" ? "·旧版" : "");
    el.dataset.state = r.state;
    el.title = r.detail || "";
  });
  lastScan = Date.now();
  paintScanTip();
}

function paintScanTip(){
  const rows = Object.keys(scanMap).map(k => scanMap[k]);
  if (!rows.length){ scanTip.textContent = "没装的会跳过"; return; }
  const n = k => rows.filter(r => r.state === k).length;
  const full = n("full"), part = n("partial"), clean = n("clean");
  /* 这一格只有百来像素宽，句子长了就被折成两行把整条挤高 */
  scanTip.textContent = part ? `${part} 个只改了一半`
    : (full && !clean ? `${full} 个都已破甲` : `${clean} 个还没动`);
}

/* 扫一遍全机。慢是真的慢（二十个目标各自要定位安装目录），所以只在
   点检测、跑完破甲/还原、以及设置里开了启动自检时才调。
   八秒内刚扫过就直接复用 —— 检测的输出流里已经带了一份，没必要再排一次盘。 */
let lastScan = 0;

async function refreshScan(){
  if (scanning) return;
  if (Date.now() - lastScan < 8000) return;
  scanning = true;
  rScan.disabled = true;
  scanTip.textContent = "正在扫…";
  try{
    const r = await fetch(`/api/scan?t=${TOKEN}`);
    const d = await r.json();
    if (d && d.ok && d.rows.length) paintScan(d.rows);
    else scanTip.textContent = "没扫出来";
  }catch(e){
    scanTip.textContent = "没扫出来：连不上";
  }finally{
    scanning = false;
    rScan.disabled = false;
  }
}
rScan.onclick = () => { if (!busy && !scanning) refreshScan(); };

/* 状态的一句话汇总，用在结论条上 */
function scanSummary(){
  const rows = Object.keys(scanMap).map(k => scanMap[k]);
  if (!rows.length) return "";
  const c = k => rows.filter(r => r.state === k).length;
  const parts = [];
  if (c("full")) parts.push(`${c("full")} 个已破甲`);
  if (c("partial")) parts.push(`${c("partial")} 个部分破甲`);
  if (c("clean")) parts.push(`${c("clean")} 个未破甲`);
  if (c("none")) parts.push(`${c("none")} 个没装`);
  return parts.join("，");
}

/* DSH 选项 */
function paintMode(){
  $("c-inject").classList.toggle("on", opts.mode === "inject");
  $("c-preset").classList.toggle("on", opts.mode === "preset");
}
optsEl.querySelectorAll('input[name="mode"]').forEach(el => {
  el.onchange = () => {
    if (el.checked){ opts.mode = el.value; paintMode(); paintSummary(); }
  };
});
$("gitbash").onchange = e => { opts.gitBash = e.target.checked; paintSummary(); };
if (!IS_WIN) $("gb-opt").style.display = "none";

/* 操作：一键破甲单独做成大按钮，其余按「常用 / 更多」两组。
   status 不出现在列表里 —— 顶部「先检测一下」就是它，列两遍只会让人猜两者有什么不同。 */
const GROUP = {revert: 1, diagnose: 2, dryrun: 2, snapshot: 2, compare: 2};
let busy = false;
ACTIONS.forEach(([key, name, desc, kind]) => {
  const g = GROUP[key];
  if (!g) return;                       /* apply 由顶部大按钮承担 */
  const b = document.createElement("button");
  b.type = "button";
  b.className = "act";
  b.dataset.kind = kind;
  b.dataset.action = key;
  b.innerHTML = `<span class="n">${name}</span><span class="d">${desc}</span><span class="go">›</span>`;
  b.onclick = () => { if (!busy) run(key); };
  (g === 1 ? actsEl : acts2El).appendChild(b);
});

/* 确认框 */
const modal = $("modal");
let pending = null;
function ask(action, name){
  pending = action;
  const list = [...selected];
  $("m-title").textContent = `确认${name}？`;
  $("m-desc").textContent = list.length
    ? `将对下面 ${list.length} 个软件执行，这会修改它们的提示词或配置文件（改前自动备份）。`
    : "还没勾选任何软件，会按「全部」处理，这会修改它们的提示词或配置文件（改前自动备份）。";
  const kv = [];
  /* 显示软件的中文名，不显示 wb / wbintl 这种内部代号；超过四个就折成
     「前三个 等 N 个」—— 十七个名字堆满一屏，反而没人看。 */
  const names = list.map(k => {
    const t = TARGETS.find(x => x[0] === k);
    return t ? t[1] : k;
  });
  const shown = !names.length ? "全部"
    : names.length > 4 ? names.slice(0, 3).join(" / ") + ` 等 ${names.length} 个`
    : names.join(" / ");
  kv.push(`<div><span>软件</span>${shown}</div>`);
  if (selected.has("dsh") || !list.length){
    kv.push(`<div><span>DSH</span>${opts.mode === "preset" ? "只加一个模式（不改官方文件）" : "改配置文件（所有模式生效）"}</div>`);
    if (IS_WIN) kv.push(`<div><span>命令行</span>${opts.gitBash ? "改用 Git Bash（要重启 DSH）" : "保持 PowerShell"}</div>`);
  }
  if (selected.has("ccgui") || !list.length){
    kv.push(`<div><span>CC GUI</span>${ccguiSummary()}</div>`);
  }
  kv.push(`<div><span>反悔</span>用「还原成原版」逐字节恢复</div>`);
  $("m-kv").innerHTML = kv.join("");
  modal.classList.add("on");
  $("m-cancel").focus();
}
$("m-cancel").onclick = () => { modal.classList.remove("on"); pending = null; };
$("m-ok").onclick = () => { modal.classList.remove("on"); if (pending) run(pending); pending = null; };
document.addEventListener("keydown", e => {
  if (e.key === "Escape" && modal.classList.contains("on")){
    modal.classList.remove("on"); pending = null;
  }
});

$("go").onclick = () => { if (!busy) ask("apply", "一键破甲"); };
$("detect").onclick = () => { if (!busy) run("status"); };
$("clear").onclick = () => {
  outEl.innerHTML = '<span class="empty">已清空。</span>';
  elapsedEl.textContent = "";
  setState("idle");
};

/* ANSI → HTML */
const ANSI = {
  "30":"#7d7566","31":"#e08a7c","32":"#8fc0a0","33":"#d9bb7c","34":"#8fa8cf",
  "35":"#c3a0d6","36":"#86c3c6","37":"#e5ddce","90":"#7d7566","91":"#e08a7c",
  "92":"#8fc0a0","93":"#d9bb7c","94":"#8fa8cf","95":"#c3a0d6","96":"#86c3c6","97":"#fbf9f4"
};
function esc(s){ return s.replace(/[&<>]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;"}[c])); }
function ansiToHtml(line){
  let out = "", open = 0, last = 0, m;
  const re = /\x1b\[([0-9;]*)m/g;
  while ((m = re.exec(line)) !== null){
    out += esc(line.slice(last, m.index));
    last = m.index + m[0].length;
    const codes = m[1].split(";").filter(Boolean);
    if (!codes.length || codes.includes("0")){
      out += "</span>".repeat(open); open = 0; continue;
    }
    for (const c of codes){
      const color = ANSI[c];
      if (color){ out += `<span style="color:${color}">`; open++; }
      else if (c === "1"){ out += `<span style="font-weight:600">`; open++; }
    }
  }
  out += esc(line.slice(last));
  return out + "</span>".repeat(open);
}

let stateTimer = null;
function setState(kind){
  clearTimeout(stateTimer);
  stateEl.classList.remove("busy", "bad", "good");
  if (kind === "busy"){ stateEl.classList.add("busy"); stateText.textContent = "处理中…"; }
  else if (kind === "bad"){ stateEl.classList.add("bad"); stateText.textContent = "有问题，看下面"; }
  else if (kind === "good"){ stateEl.classList.add("good"); stateText.textContent = "完成"; }
  else stateText.textContent = "待命中";
}
/* 输出里出现这些字样就当成「没跑通」，胶囊转红，省得小白翻几百行找 */
const BAD = /(\[!\]|\[x\]|Traceback|失败|出错|错误：|Error:|not found|拒绝访问)/i;
const SENTINEL = "__POJIA_EXIT__:";

/* 动作的中文名：结论条上写「一键破甲完成」，不写 apply 完成 */
function actionName(key){
  const hit = ACTIONS.filter(a => a[0] === key)[0];
  return hit ? hit[1] : key;
}

/* 主界面上那一句话：成没成、用时多少、为什么不成就去看运行记录。
   详细输出在「运行记录」页 —— 这里只负责让人不用翻日志就知道结果。 */
/* 退出码的语义（跟 CLI 一致）：0 跑通、1 有没办成/需要处理的、2 根本没跑起来。
   只读动作的 1 不是失败 —— 体检本来就会「查出 5 项需要处理」，那是它干完活了，
   写成一抹朱红的「失败」只会把人吓一跳。 */
const READ_ACTIONS = {status: 1, diagnose: 1, check: 1, dryrun: 1, snapshot: 1, compare: 1};
/* 跑完要重扫行上状态的动作。预演、诊断、快照都不动文件，没必要再扫一遍。 */
const SCAN_AFTER = {status: 1, apply: 1, revert: 1};

function showResult(action, code, plain, secs){
  const name = actionName(action);
  const clean = plain.replace(/\x1b\[[0-9;]*m/g, "");
  const hit = clean.split("\n").filter(l => BAD.test(l) && l.trim())[0] || "";
  let state;
  if (code === 2) state = "bad";
  else if (code === 1) state = READ_ACTIONS[action] ? "warn" : "bad";
  else if (code === null) state = BAD.test(plain) ? "bad" : "ok";
  else state = "ok";

  if (state === "bad"){
    rTitle.textContent = "失败";
    rText.textContent = `${name}没有跑通`
      + (hit ? `：${hit.trim().replace(/^[\[!x\]]+\s*/i, "").slice(0, 70)}` : "")
      + `。报错请看运行记录。`;
  } else if (state === "warn"){
    rTitle.textContent = "完成";
    rText.textContent = `${name}跑完了，有需要处理的地方。细节在运行记录里。`;
  } else if (action === "status"){
    /* 检测的结论不在日志里，在左边那列的字上；这里只报总数 */
    rTitle.textContent = "检测完毕";
    rText.textContent = (scanSummary() || "扫完了") + "。每行对着看，细节在运行记录。";
  } else {
    rTitle.textContent = "成功";
    rText.textContent = `${name}完成，用时 ${secs.toFixed(1)}s。每一步都记在运行记录里。`;
  }
  resultEl.classList.toggle("bad", state === "bad");
  resultEl.classList.toggle("warn", state === "warn");
  resultEl.classList.toggle("ok", state === "ok");
  resultEl.hidden = false;
}

rLog.onclick = () => showPage("log", true);

let started = false;
async function run(action){
  if (busy) return;
  const upd = action === "update";
  busy = true;
  setState("busy");
  resultEl.hidden = true;        /* 上一轮的结论先收起来，别跟这一轮混 */
  if (upd){
    /* 升级的输出和进度留在「设置」页：那儿有通道、有检查按钮，
       点完不该把人拽到另一个页面去读日志。 */
    startUpdateUI();
    showPage("settings");
  } else {
    /* 点了就跑，输出记进「运行记录」，但**不切页** —— 结论写在左列每行的
       状态上，把人拽去读几十行日志纯属多余。想看细节的点左边「运行记录」。 */
    consoleEl.classList.add("on");
  }
  goBtn.disabled = true;
  document.body.classList.add("running");
  document.querySelectorAll(".act").forEach(b => b.disabled = true);
  if (!started){ outEl.innerHTML = ""; started = true; }
  const t0 = Date.now();
  const timer = setInterval(() => {
    elapsedEl.textContent = ((Date.now() - t0) / 1000).toFixed(1) + "s";
  }, 100);
  let plain = "";
  let code = null;               /* 服务端在最后补一行退出码：成败看它，不靠猜字样 */
  const take = p => {
    if (p.indexOf(SENTINEL) === 0){
      code = parseInt(p.slice(SENTINEL.length), 10);
      return true;
    }
    return false;
  };
  /* 一行一处分流：进度行喂进度条，#status 刷每行状态，别的行进日志。 */
  const emitLine = p => {
    if (p.indexOf("#progress ") === 0){
      const a = p.split(" ");
      setProgress(parseInt(a[1], 10), a[2], a[3]);
      return;
    }
    if (p.indexOf("#status ") === 0){
      let rows = null;
      try{ rows = JSON.parse(p.slice(8)); }catch(e){}
      if (Array.isArray(rows)){
        paintScan(rows);
        /* 日志页也要有东西看：拿同一份数据拼成人读的表格，不排第二次盘 */
        rows.forEach(r => outEl.insertAdjacentHTML("beforeend", ansiToHtml(
          "  " + String(r.key || "").padEnd(11) + " "
          + String(r.name || "").padEnd(22) + " " + (r.label || "")
          + (r.detail ? "  " + r.detail : "")) + "\n"));
      }
      return;
    }
    plain += p + "\n";
    if (upd) appendUpd(p);
    else outEl.insertAdjacentHTML("beforeend", ansiToHtml(p) + "\n");
  };
  try{
    const res = await fetch(`/api/run?t=${TOKEN}`, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({
        action, targets: [...selected], confirm: true,
        dsh_mode: opts.mode, git_bash: opts.gitBash,
        ccgui_components: ccguiComponents()
      })
    });
    if (!res.ok || !res.body){
      outEl.insertAdjacentHTML("beforeend", `<span style="color:#e08a7c">请求失败：HTTP ${res.status}</span>\n`);
      plain += "失败";
    } else {
      const reader = res.body.getReader();
      const dec = new TextDecoder("utf-8");
      let buf = "";
      while (true){
        const {done, value} = await reader.read();
        if (done) break;
        buf += dec.decode(value, {stream: true});
        const parts = buf.split("\n");
        buf = parts.pop();
        for (const p of parts){
          if (take(p)) continue;
          emitLine(p);
        }
        outEl.scrollTop = outEl.scrollHeight;
      }
      if (buf && !take(buf)) emitLine(buf);
    }
  }catch(e){
    emitLine(String(e));
  }finally{
    clearInterval(timer);
    busy = false;
    document.body.classList.remove("running");
    consoleEl.classList.remove("on");
    outEl.scrollTop = outEl.scrollHeight;
    /* 有退出码就以退出码为准：只读动作打出 [!] 提示是正常的，
       按字样判会把「体检完了，有两处要注意」当成失败。 */
    const failed = code === null ? BAD.test(plain) : (code === 2 || (code === 1 && !READ_ACTIONS[action]));
    setState(failed ? "bad" : "good");
    stateTimer = setTimeout(() => { if (!busy) setState("idle"); }, failed ? 12000 : 5000);
    document.querySelectorAll(".act").forEach(b => b.disabled = false);
    sync();
    /* 升级已经安排好了：服务端马上自己退出，这个页面随即断线。
       与其让人对着一个加载不出来的页面发呆，不如盖一层说清楚 ——
       顺便试一下关掉自己（有的浏览器不让关不是脚本打开的标签，关不掉就算了）。 */
    if (upd){
      if (failed){
        /* 没装成得能再来一次：刚才 hide 掉的安装按钮放回来，
           不然只剩「再点一遍检查更新」这一条路，白查一次。 */
        updState("升级没有完成，看上面的输出", "bad");
        uInstall.hidden = !updTarget;
        uCheck.disabled = false;
      } else if (plain.indexOf("已安排") >= 0){
        showUpgrading();
      } else {
        /* 没安排换装又没报错（比如只是提示一下），留在设置页把话说清楚 */
        updState("没有可装的更新", "ok");
        uCheck.disabled = false;
      }
    } else {
      /* 破甲 / 还原 / 检测跑完：先就地重扫一遍每行的状态，再写结论 ——
         顺序反了，结论条拿到的就是上一轮的数字。 */
      if (SCAN_AFTER[action]) await refreshScan();
      showResult(action, code, plain, (Date.now() - t0) / 1000);
    }
  }
}

sync();

/* ── 换页 ────────────────────────────────────────────────────
   左边点哪个就显示哪一块，其余 display:none。不用滚到页面底下去找运行记录。 */
const PAGE_TITLE = {main: "一键破甲", log: "运行记录", settings: "设置"};
const navBtns = [...document.querySelectorAll(".nav-i[data-page]")];

function showPage(id, remember){
  if (!PAGE_TITLE[id]) id = "main";
  Object.keys(PAGE_TITLE).forEach(k => {
    const el = $("page-" + k);
    if (el) el.classList.toggle("on", k === id);
  });
  navBtns.forEach(b => b.setAttribute("aria-current",
    b.dataset.page === id ? "page" : "false"));
  $("ptitle").textContent = PAGE_TITLE[id];
  if (id === "settings") loadSettings();
  if (remember !== false){
    try{ localStorage.setItem("pojia.page", id); }catch(e){}
  }
}

navBtns.forEach(b => { b.onclick = () => showPage(b.dataset.page); });

/* 边栏收起：只留图标。窄屏由 CSS 接管，这里只管手动那一下。 */
const sideEl = $("side"), foldBtn = $("fold");
function paintFold(){
  const slim = sideEl.classList.contains("slim");
  foldBtn.textContent = slim ? "›" : "‹";
  foldBtn.title = slim ? "展开" : "收起";
  foldBtn.setAttribute("aria-label", foldBtn.title + "边栏");
}
foldBtn.onclick = () => {
  sideEl.classList.toggle("slim");
  try{
    localStorage.setItem("pojia.slim", sideEl.classList.contains("slim") ? "1" : "");
  }catch(e){}
  paintFold();
};
try{ if (localStorage.getItem("pojia.slim") === "1") sideEl.classList.add("slim"); }catch(e){}
paintFold();

/* ── 设置：更新通道 ──────────────────────────────────────────
   通道决定「检查更新」看得见哪些发布：
     前期测试 收 前期测试 + 测试 + 正式
     测试     收 测试 + 正式
     稳定     只收正式
   存在程序自己的状态目录里，不写注册表；命令行 --settings 读的是同一份。 */
const CHAN_DESC = {
  alpha: "刚做出来的功能最先到这儿，也最容易碰到半成品。同时收测试版和正式版。",
  beta:  "功能基本定形，还在挑毛病。同时收正式版。",
  mod:   "只收正式版。想稳就用这个。"
};
const CHAN_TAG = {alpha: "最早", beta: "常用", mod: "最稳"};

const setChan = $("set-chan"), setAuto = $("set-auto"), setMsg = $("set-msg");
const setScan = $("set-scan");
let setCfg = {channel: "", auto_check: true, auto_scan: false, channels: []};

function drawChannels(){
  setChan.innerHTML = "";
  const list = (setCfg.channels && setCfg.channels.length) ? setCfg.channels
    : [{id:"alpha",name:"前期测试通道"},{id:"beta",name:"测试通道"},{id:"mod",name:"稳定通道"}];
  list.forEach(c => {
    const on = c.id === setCfg.channel;
    const el = document.createElement("label");
    el.className = "choice" + (on ? " on" : "");
    el.innerHTML = '<input type="radio" name="chan" value="' + c.id + '"'
      + (on ? " checked" : "") + '>'
      + '<span><span class="ct">' + esc(c.name)
      + '<span class="tag">' + (CHAN_TAG[c.id] || "") + '</span></span>'
      + '<span class="cd">' + (CHAN_DESC[c.id] || "") + '</span></span>';
    el.querySelector("input").onchange = () => {
      setCfg.channel = c.id;
      drawChannels();
      saveSettings({channel: c.id});
    };
    setChan.appendChild(el);
  });
}

function flashSaved(){
  setMsg.classList.add("on");
  clearTimeout(flashSaved._t);
  flashSaved._t = setTimeout(() => setMsg.classList.remove("on"), 1400);
}

async function saveSettings(patch){
  try{
    const r = await fetch(`/api/settings?t=${TOKEN}`, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify(patch)
    });
    const d = await r.json();
    if (d && d.channel) setCfg = Object.assign({}, setCfg, d);
    setAuto.checked = !!setCfg.auto_check;
    setScan.checked = !!setCfg.auto_scan;
    flashSaved();
    probeUpdate();                 /* 通道换了，提示跟着重算 */
  }catch(e){}
}

async function loadSettings(){
  try{
    const r = await fetch(`/api/settings?t=${TOKEN}`);
    const d = await r.json();
    if (d && d.channel) setCfg = d;
  }catch(e){}
  drawChannels();
  setAuto.checked = !!setCfg.auto_check;
  setScan.checked = !!setCfg.auto_scan;
}

setAuto.onchange = () => saveSettings({auto_check: setAuto.checked});
setScan.onchange = () => saveSettings({auto_scan: setScan.checked});

/* ── 更新提示 ────────────────────────────────────────────────
   进页面问一次「有没有新版」：只读 GitHub 的发布信息，不带任何本机内容。
   查到就亮一条，装不装、什么时候装，由按按钮的人决定 —— 从不自己动手。 */
async function probeUpdate(){
  /* 点过「以后再说」就这次版本内不再问（下次开还是同一版，没必要反复问） */
  if (localStorage.getItem("pojia.skipUpdate") === VERSION) return;
  try{
    const res = await fetch(`/api/update?t=${TOKEN}`);
    if (!res.ok) return;
    const d = await res.json();
    if (!d.ok || !d.newer) return;
    uText.innerHTML = `有新版本 <b class="mono">v${esc(d.latest)}</b> 可以装`
      + `（当前 v${esc(d.current)}）。点一下就开始：程序会自己退出，换好文件再打开。`;
    uGo.textContent = `安装 v${d.latest}`;
    uBar.hidden = false;
  }catch(e){ /* 没网、限流、被墙都当没这回事 */ }
}

uGo.onclick = () => {
  uBar.hidden = true;
  run("update");
};
uNo.onclick = () => {
  uBar.hidden = true;
  try{ localStorage.setItem("pojia.skipUpdate", VERSION); }catch(e){}
};

/* ── 设置页的「检查更新」 ────────────────────────────────────
   以前只有顶上那条提示，查不查要等它自己弹。现在这儿有个手动按钮：
   查到了就地装，进度也在这一页看，不用再跑回顶上点。 */

let updTarget = "";            /* 查到的版本；装失败后靠它把按钮放回来 */

function updState(text, kind){
  uState.textContent = text;
  uState.className = "updmsg" + (kind ? " " + kind : "");
}

function setProgress(pct, got, total){
  const v = Math.max(0, Math.min(100, pct || 0));
  uFill.style.width = v + "%";
  uPct.textContent = (+total > 0)
    ? `${v}% · ${(+got).toFixed(1)}/${(+total).toFixed(1)} MB`
    : `${v}%`;
}

function startUpdateUI(){
  uProg.hidden = false;
  uLog.hidden = false;
  uLog.textContent = "";
  setProgress(0, 0, 0);
  updState("正在准备…");
  uInstall.hidden = true;
  uCheck.disabled = true;
}

function appendUpd(line){
  uLog.textContent += line.replace(/\x1b\[[0-9;]*m/g, "").replace(/^\s+/, "") + "\n";
  uLog.scrollTop = uLog.scrollHeight;
}

uCheck.onclick = async () => {
  uCheck.disabled = true;
  uInstall.hidden = true;
  updState("检查中…");
  try{
    const r = await fetch(`/api/update?t=${TOKEN}`);
    const d = await r.json();
    if (!d || !d.ok){
      updTarget = "";
      updState("没查成：" + ((d && d.note) || "网络不通"), "bad");
    } else if (d.newer){
      updTarget = d.latest;
      updState(`有新版本 v${d.latest}（当前 v${d.current}）`, "ok");
      uInstall.textContent = `安装 v${d.latest}`;
      uInstall.hidden = false;
    } else {
      updTarget = "";
      updState(`已是最新（v${d.current}）`, "ok");
    }
  }catch(e){
    updState("没查成：连不上", "bad");
  }finally{
    uCheck.disabled = false;
  }
};

uInstall.onclick = () => run("update");

/* 升级中那一层：服务端安排好换装就自己退了，页面随即断线。
   盖一层说明比让人对着加载不出来的页面强；顺手试一下自关。 */
function showUpgrading(){
  if (document.getElementById("upgrading")) return;
  const d = document.createElement("div");
  d.id = "upgrading";
  d.setAttribute("style", [
    "position:fixed", "inset:0", "z-index:9999", "display:flex",
    "flex-direction:column", "align-items:center", "justify-content:center",
    "gap:8px", "text-align:center", "padding:24px",
    "background:var(--paper)", "color:var(--ink)",
    "font:15px/1.8 system-ui,-apple-system,'Segoe UI',sans-serif"
  ].join(";"));
  d.innerHTML = '<div style="font-size:20px;font-weight:700">正在升级…</div>'
    + '<div style="color:var(--ink-2)">程序会自己退出，换好文件再打开。'
    + '<br>这个页面可以关掉了。</div>';
  document.body.appendChild(d);
  try{ setTimeout(() => window.close(), 300); }catch(e){}
}

/* 先问设置：关掉「启动时检查更新」就一次网络请求都不发。
   拿到之后再决定要不要查 —— 顺序反了就等于没关。
   自检同理：默认关，扫盘要几秒，不能每次开界面都白等。 */
(async function boot(){
  try{
    const r = await fetch(`/api/settings?t=${TOKEN}`);
    const d = await r.json();
    if (d && d.channel) { setCfg = d; }
  }catch(e){}
  setAuto.checked = !!setCfg.auto_check;
  setScan.checked = !!setCfg.auto_scan;
  if (setCfg.auto_scan) refreshScan();
  if (setCfg.auto_check !== false) probeUpdate();
})();
