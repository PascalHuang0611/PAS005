// PAS005 二階分析儀表板

let currentChart = null;
let currentRtpRoundChart = null;
let currentSummaryBarChart = null;
let currentRtpDistChart = null;
let currentMaxWinDistChart = null;
let currentMaxLossDistChart = null;
let currentWinRunChart = null;
let currentLossRunChart = null;
let currentMultDistChart = null;
let globalData = [];
let rawData = []; // 未截斷的原始報表資料
let allReports = {};
let currentSortCol = null;
let currentSortAsc = false; // 預設降冪排序
let currentSystem = 'ALPHA';
// 詳細版:本地進階統計(detail.html 專用;內容僅本機顯示,不隨站台發布)
window.diagData = {};
window.renderDiag = async function (run, dist, config, system) {
    const out = document.getElementById('diag-out');
    if (!out) return;
    const key = `${run}/${dist}_${config}/${(system || '').toLowerCase()}`;
    if (!window.diagData[key]) {
        // 自動抓取(與報表同伺服器的 diagnostics/;無檔或本地未起服則靠手動載入)
        try {
            const res = await fetch(`../diagnostics/${key.replace(/\/([a-z]+)$/, '/water_stats_$1.json')}`);
            if (res.ok) window.diagData[key] = await res.json();
        } catch (e) { }
    }
    const sets = window.diagData[key];
    if (!sets) { out.innerHTML = '<p style="color:var(--text-secondary)">(此選擇無統計資料——ALPHA 為對照組、無此類檔案;其餘系統會自動載入,離線時可用下方手動載入)</p>'; return; }
    let html = '';

    // 額外抽樣彙總:成功次數自逐局欄位加總,放棄次數自各項最後一個計數(× 上限)推算
    const RETRY_LIMIT = 1000;
    let rounds = 0, extra = 0, evs = 0, giveups = 0;
    (globalData || []).forEach(pl => (pl.history || []).forEach(h => {
        rounds++;
        if (h.rerolls) { extra += h.rerolls; evs++; }
    }));
    sets.forEach(st => (st.pools || []).forEach(pp => {
        if (/[（(]/.test(pp.pool_name)) {
            const nums = pp.pool_name.match(/\d+(?:\.\d+)?/g);
            if (nums) giveups += Math.round(+nums[nums.length - 1]);
        }
    }));
    if (rounds) {
        const total = extra + giveups * RETRY_LIMIT;
        html += `<div style="padding:8px 10px;margin-bottom:10px;border:1px solid rgba(255,255,255,.15);border-radius:6px;">
            <strong>額外抽樣彙總(本視圖)</strong><br>
            自然轉數 ${rounds.toLocaleString()} ｜ 成功重試 ${extra.toLocaleString()} 抽(${evs.toLocaleString()} 局觸發)
            ｜ 放棄 ${giveups} 次 × 上限 ${RETRY_LIMIT} = ${(giveups * RETRY_LIMIT).toLocaleString()} 抽<br>
            <span style="color:var(--text-secondary)">合計 ${total.toLocaleString()} 抽 = 自然轉數的 <strong>${(total / rounds * 100).toFixed(0)}%</strong>(落地時的額外運算成本指標)<br>
            註:成功重試依上方局數/BET 篩選連動;放棄次數為整批統計、不隨篩選縮放,故比例在短視圖下會偏高。</span>
        </div>`;
    }
    sets.forEach(st => {
        html += `<h3 style="margin:10px 0 4px;">$${st.bet}${st.scope ? ' · ' + st.scope : ''}${st.players ? ' · n=' + st.players : ''}</h3>`;
        html += `<p style="font-size:.85rem;color:var(--text-secondary)">base ${(+st.prefund_mult).toFixed(1)} ｜ in ${(+st.contrib_mult).toFixed(1)} ｜ out ${(+st.paid_mult).toFixed(1)} ｜ end ${(+st.final_mult).toFixed(1)}</p>`;
        html += '<table style="width:100%"><thead><tr><th>ID</th><th style="text-align:left">名稱</th><th>次數</th><th>已付</th><th>剩餘</th></tr></thead><tbody>';
        (st.pools || []).forEach(pp => {
            html += `<tr><td>${pp.pool_id}</td><td style="text-align:left">${pp.pool_name}</td><td>${pp.triggers}</td><td>${(+pp.paid_mult).toFixed(1)}</td><td>${(+pp.water_mult).toFixed(2)}</td></tr>`;
        });
        html += '</tbody></table>';
    });
    out.innerHTML = html;
};
document.addEventListener('DOMContentLoaded', () => {
    const up = document.getElementById('diag-upload');
    if (!up) return;
    up.addEventListener('change', async (e) => {
        for (const f of e.target.files) {
            const m = (f.webkitRelativePath || '').split('\\').join('/').match(/run_(\d+)\/(\w+)_(\w+)\/water_stats_(\w+)\.json$/);
            if (!m) continue;
            try { window.diagData[`run_${m[1]}/${m[2]}_${m[3]}/${m[4]}`] = JSON.parse(await f.text()); } catch (err) { }
        }
        document.getElementById('diag-out').innerHTML = `<p>已載入 ${Object.keys(window.diagData).length} 份;切換上方任一選項即會顯示。</p>`;
    });
});

let currentRoundLimit = 200; // 顯示前 N 局(預設 200;使用者選擇記錄於 localStorage)
let currentWinDef = 'hit';   // 'hit' = win>0;'winrate' = win>=bet
let FETCH_BASE = 'reports/'; // 自動載入時偵測 (repo 根目錄或 web/ 子目錄兩種佈局)
let manualMode = false;

const CHART_COLORS = {
    1: '#3b82f6',  // Blue
    5: '#10b981',  // Emerald Green
    10: '#f59e0b', // Amber/Orange
    2: '#8b5cf6',  // Purple
    20: '#ec4899', // Pink
    50: '#06b6d4'  // Cyan
};
const FALLBACK_COLORS = ['#ef4444', '#64748b', '#14b8a6', '#f43f5e'];

function getGroupColorHex(bet, fallbackIdx = 0) {
    if (CHART_COLORS[bet]) return CHART_COLORS[bet];
    return FALLBACK_COLORS[fallbackIdx % FALLBACK_COLORS.length];
}

function hexToRgba(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// 勝的判定:二階報表有 win 欄位(原始贏分);舊格式 fallback 用 result
function isWin(round, betAmount) {
    if (round.win !== undefined) {
        return currentWinDef === 'hit' ? round.win > 0 : round.win >= betAmount;
    }
    return round.result === 'Win';
}

// 罕見連輸門檻:單次發生機率 <= 0.5^k 的最短連輸長度(k=8 → <0.4%,k=10 → <0.1%)
function eqRarityThreshold(p, k) {
    if (p <= 0 || p >= 1) return 0;
    return Math.ceil(k * Math.log(0.5) / Math.log(1 - p));
}

document.addEventListener("DOMContentLoaded", () => {
    const fileInput = document.getElementById('file-upload');
    const fileNameDisplay = document.getElementById('file-name');

    // Modal logic
    const modal = document.getElementById('player-modal');
    const closeBtn = document.querySelector('.close-btn');
    if (closeBtn) {
        closeBtn.onclick = function() {
            modal.style.display = "none";
            document.body.style.overflow = ''; // 恢復一級介面滾動
        }
    }
    window.onclick = function(event) {
        if (event.target == modal) {
            modal.style.display = "none";
            document.body.style.overflow = '';
        }
    }

    const uploadSection = document.getElementById('upload-section');
    const controlsSection = document.getElementById('controls-section');
    const sysBtns = document.querySelectorAll('.sys-btn[data-system]');

    let currentConfig = null; // 參數組
    let currentDist = 'unequal'; // "unequal" or "equal"
    let currentRun = 'run_1';
    // BET 過濾器:啟用中的注額(可單看可聯看;至少保留一個)
    const activeBets = new Set([1, 5, 10]);

    // 已知參數組
    const knownConfigs = ['base', 'base2', 'special', 'special2'];
    const CONFIG_LABELS = { base: '基1', base2: '基2', special: '特1', special2: '特2' };
    // 各系統目前已產出的參數組(隨機起點只抽有資料的組合)
    const SYS_CONFIGS = { ALPHA: knownConfigs, OSCAR: knownConfigs, DELTA: knownConfigs, BRAVO: knownConfigs, TANGO: knownConfigs };

    // 盲測版:每次進入隨機起點,避免錨定效應(目前單系統單參數,保留機制)
    if (window.BLIND_MODE) {
        const systems = [...sysBtns].map(b => b.dataset.system);
        currentSystem = systems[Math.floor(Math.random() * systems.length)];
        const cfgPool = SYS_CONFIGS[currentSystem] || knownConfigs;
        currentConfig = cfgPool[Math.floor(Math.random() * cfgPool.length)];
        sysBtns.forEach(btn => {
            btn.classList.toggle('active', btn.dataset.system === currentSystem);
        });
    }

    // 報表內部索引 key(自動/手動載入共用同一格式)
    function reportKey(run, dist, config, system) {
        return `${run}/${dist}_${config}/simulation_${system.toLowerCase()}_log.json`;
    }

    // 嘗試自動載入(支援兩種佈局:網頁在 repo 根目錄 → reports/;網頁在 web/ → ../reports/)
    async function tryAutoLoad() {
        fileNameDisplay.textContent = '嘗試自動連線並讀取報表...';
        allReports = {};

        for (const base of ['reports/', '../reports/']) {
            try {
                const testPath = base + reportKey('run_1', 'unequal', knownConfigs[0], currentSystem);
                const res = await fetch(testPath, { method: 'HEAD' });
                if (!res.ok) continue;
                FETCH_BASE = base;
                manualMode = false;
                fileNameDisplay.textContent = '系統就緒，點擊上方選項載入對應報表';
                setupUIAfterLoad();
                return;
            } catch (e) { /* 換下一個 base */ }
        }
        fileNameDisplay.textContent = '本地環境無法自動讀取，請手動選擇 Reports 資料夾上傳';
    }

    // 建立參數頁籤與切換邏輯
    // 頁首控制列不顯示(Pascal:版面乾淨,統一用右下角懸浮面板;按鈕留在 DOM 供面板代理點擊)
    function setupUIAfterLoad() {
        uploadSection.style.display = 'none';
        controlsSection.style.display = 'none';

        const tabsMain = document.getElementById('tabs-container-main');
        tabsMain.innerHTML = '';

        currentConfig = currentConfig || knownConfigs[0];

        initFloatingPanel();

        knownConfigs.forEach(config => {
            const btn = document.createElement('button');
            btn.className = `tab-btn ${config === currentConfig ? 'active' : ''}`;
            btn.dataset.config = config;
            btn.textContent = CONFIG_LABELS[config] || config;

            btn.addEventListener('click', () => {
                document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                currentConfig = config;
                loadCurrentSelection();
            });

            tabsMain.appendChild(btn);
        });

        syncFloatingPanel(); // 頁籤建好後同步面板高亮(含隨機起點抽到的參數組)
        loadCurrentSelection();
    }

    // 根據目前的 system, dist, run 與 config 載入資料(自動模式按需 fetch;手動模式讀已上傳的快取)
    async function loadCurrentSelection() {
        if (!currentConfig) return;
        const key = reportKey(currentRun, currentDist, currentConfig, currentSystem);

        fileNameDisplay.textContent = `正在讀取報表: ${key} ...`;

        if (window.renderDiag) window.renderDiag(currentRun, currentDist, currentConfig, currentSystem);
        if (allReports[key]) {
            renderData(allReports[key]);
            fileNameDisplay.textContent = `目前顯示: ${key}`;
            return;
        }

        if (manualMode) {
            alert(`上傳的資料夾中找不到 ${currentSystem} 在 ${currentDist}_${currentConfig} (${currentRun}) 的數據。`);
            fileNameDisplay.textContent = `找不到: ${key}`;
            return;
        }

        try {
            const res = await fetch(FETCH_BASE + key);
            if (!res.ok) throw new Error("HTTP error " + res.status);
            const data = await res.json();

            allReports[key] = data;
            renderData(data);
            fileNameDisplay.textContent = `目前顯示: ${key}`;
        } catch (error) {
            alert(`找不到 ${currentSystem} 系統在 ${currentDist}_${currentConfig} 的數據，或載入失敗。`);
            fileNameDisplay.textContent = `載入失敗: ${key}`;
        }
    }

    function renderData(data) {
        rawData = data;
        applyRoundLimit();
    }

    // 依 BET 過濾器 + currentRoundLimit 將原始資料轉成目前視圖
    // rtp/maxWin/maxLoss 等統計欄位一律由 processData 從截斷後的 history 重算,此處不預算
    function applyRoundLimit() {
        const N = currentRoundLimit;
        globalData = rawData.filter(p => activeBets.has(p.betAmount)).map(p => {
            const hist = p.history.slice(0, N);
            return {
                ...p,
                history: hist,
                totalPlays: hist.length,
                // balanceAfter 是累計值,截斷後的損益直接取最後一筆
                finalBalance: hist.length ? hist[hist.length - 1].balanceAfter : 0
            };
        });
        // 重設排序狀態
        currentSortCol = null;
        currentSortAsc = false;
        document.querySelectorAll("th.sortable").forEach(h => {
            h.classList.remove('asc', 'desc');
        });
        processData(globalData);
        // 詳細版:視圖變動(系統/參數/局數/BET 過濾)後刷新進階統計
        if (window.renderDiag) window.renderDiag(currentRun, currentDist, currentConfig, currentSystem);
    }

    // 系統切換器
    sysBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            sysBtns.forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            currentSystem = e.target.dataset.system;
            loadCurrentSelection();
        });
    });

    // 模擬批次切換器
    const runBtns = document.querySelectorAll('.run-btn');
    runBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            runBtns.forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            currentRun = e.target.dataset.run;
            loadCurrentSelection();
        });
    });

    // 顯示局數切換器 (純前端截斷,不需重新抓資料;選擇記錄於 localStorage)
    const roundsBtns = document.querySelectorAll('.rounds-btn');
    roundsBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            roundsBtns.forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            currentRoundLimit = parseInt(e.target.dataset.rounds);
            localStorage.setItem('pas005_round_limit', currentRoundLimit);
            if (rawData.length > 0) applyRoundLimit();
        });
    });

    // 勝定義切換器 (純前端重算,不需重新抓資料;選擇記錄於 localStorage)
    const winDefBtns = document.querySelectorAll('.windef-btn');
    winDefBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            winDefBtns.forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            currentWinDef = e.target.dataset.windef;
            localStorage.setItem('pas005_windef', currentWinDef);
            if (rawData.length > 0) applyRoundLimit();
        });
    });

    // 還原使用者上次的檢視偏好(局數/勝定義/BET 過濾;系統與參數組不還原,保持盲測隨機起點)
    (function restoreViewPrefs() {
        const savedRounds = parseInt(localStorage.getItem('pas005_round_limit'));
        const roundsBtn = document.querySelector(`.rounds-btn[data-rounds="${savedRounds}"]`);
        if (roundsBtn) {
            currentRoundLimit = savedRounds;
            roundsBtns.forEach(b => b.classList.toggle('active', b === roundsBtn));
        }
        const savedWinDef = localStorage.getItem('pas005_windef');
        const winDefBtn = document.querySelector(`.windef-btn[data-windef="${savedWinDef}"]`);
        if (winDefBtn) {
            currentWinDef = savedWinDef;
            winDefBtns.forEach(b => b.classList.toggle('active', b === winDefBtn));
        }
        try {
            const savedBets = JSON.parse(localStorage.getItem('pas005_bets'));
            if (Array.isArray(savedBets)) {
                const valid = savedBets.filter(b => [1, 5, 10].includes(b));
                if (valid.length) {
                    activeBets.clear();
                    valid.forEach(b => activeBets.add(b));
                }
            }
        } catch (e) { /* 壞資料就用預設 */ }
    })();

    // 玩家配置切換器
    const distBtns = document.querySelectorAll('.dist-btn');
    distBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            distBtns.forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            currentDist = e.target.dataset.dist;
            setupUIAfterLoad();
        });
    });

    // 手動上傳邏輯
    if (fileInput) {
        fileInput.addEventListener('change', async (event) => {
            const files = event.target.files;
            if (!files || files.length === 0) return;

            fileNameDisplay.textContent = '讀取中...';
            allReports = {};
            manualMode = true;

            const jsonFiles = Array.from(files).filter(f => f.name.endsWith('.json'));
            const totalFiles = jsonFiles.length;
            let loadedCount = 0;

            for (let i = 0; i < jsonFiles.length; i++) {
                const file = jsonFiles[i];
                loadedCount++;
                if (loadedCount % 5 === 0 || loadedCount === totalFiles) {
                    fileNameDisplay.textContent = `讀取中... (${loadedCount}/${totalFiles})`;
                }

                try {
                    const pathName = (file.webkitRelativePath || file.name).replace(/\\/g, '/');
                    if (/(^|\/)meta\.json$/.test(pathName)) continue; // meta 由模擬器產生,網頁不需要

                    const data = JSON.parse(await file.text());

                    const sysMatch = pathName.match(/simulation_(\w+)_log\.json$/);
                    const configMatch = pathName.match(/(?:unequal|equal)_([A-Za-z0-9_]+?)\//);
                    const distMatch = pathName.match(/(unequal|equal)_/);
                    const runMatch = pathName.match(/run_\d+/);
                    if (sysMatch && configMatch && distMatch) {
                        const run = runMatch ? runMatch[0] : 'run_1';
                        allReports[reportKey(run, distMatch[1], configMatch[1], sysMatch[1])] = data;
                    } else {
                        allReports[pathName] = data; // fallback
                    }
                } catch (error) {
                    console.error("Error parsing JSON:", error);
                }
            }

            if (Object.keys(allReports).length > 0) {
                setupUIAfterLoad();
            } else {
                fileNameDisplay.textContent = '資料夾內沒有找到 JSON 報告';
            }
        });
    }

    // ==========================================
    // 懸浮快速切換面板 (代理點擊頁首按鈕,狀態單一來源)
    // ==========================================
    function initFloatingPanel() {
        if (document.getElementById('fp-fab')) {
            syncFloatingPanel();
            return;
        }

        const fab = document.createElement('button');
        fab.id = 'fp-fab';
        fab.title = '快速切換選項';
        fab.textContent = '🎛';
        document.body.appendChild(fab);

        const panel = document.createElement('div');
        panel.id = 'floating-switcher';
        panel.innerHTML = `
            <div class="fp-title"><span>快速切換</span><span id="fp-close" title="收合">&times;</span></div>
            <div class="fp-row"><label>批次</label><div class="fp-btns" id="fp-run"></div></div>
            <div class="fp-row"><label>配置</label><div class="fp-btns" id="fp-dist">
                <button data-dist="unequal" title="不均等配置:Bet1 100人 / Bet5 10人 / Bet10 2人">不均等</button>
                <button data-dist="equal" title="均等配置:每個 BET 100人">均等</button>
            </div></div>
            <div class="fp-row"><label>BET</label><div class="fp-btns" id="fp-bets">
                <button data-bet="1" title="點擊開啟/關閉 $1 玩家的統計(可複選,至少保留一個)">$1</button>
                <button data-bet="5" title="點擊開啟/關閉 $5 玩家的統計(可複選,至少保留一個)">$5</button>
                <button data-bet="10" title="點擊開啟/關閉 $10 玩家的統計(可複選,至少保留一個)">$10</button>
            </div></div>
            <div class="fp-row"><label>系統</label><div class="fp-btns" id="fp-sys"></div></div>
            <div class="fp-row"><label>參數</label><div class="fp-btns" id="fp-config"></div></div>
            <div class="fp-row"><label>勝定義</label><div class="fp-btns" id="fp-windef">
                <button data-windef="hit" title="HIT:單局總贏分 > 0 就算勝">HIT</button>
                <button data-windef="winrate" title="WINRATE:單局總贏分 ≥ 注額才算勝">WINRATE</button>
            </div></div>
            <div class="fp-row"><label>局數</label><select id="fp-rounds" class="fp-select">
                ${[5, 10, 15, 20, 50, 100, 200, 500, 1000].map(n => `<option value="${n}">前 ${n} 局</option>`).join('')}
            </select></div>
        `;
        document.body.appendChild(panel);

        // 批次小按鈕(依頁首隱藏按鈕自動生成,批次數改了這裡不用動)
        const fpRun = panel.querySelector('#fp-run');
        document.querySelectorAll('.run-btn[data-run]').forEach(srcBtn => {
            const b = document.createElement('button');
            b.textContent = srcBtn.dataset.run.replace('run_', '');
            b.title = '模擬批次 Run ' + b.textContent;
            b.dataset.run = srcBtn.dataset.run;
            fpRun.appendChild(b);
        });

        // 系統小按鈕(取代號首字母;hover 顯示全名)
        const fpSys = panel.querySelector('#fp-sys');
        document.querySelectorAll('.sys-btn[data-system]').forEach(srcBtn => {
            const b = document.createElement('button');
            b.textContent = srcBtn.dataset.system.charAt(0);
            b.title = srcBtn.dataset.system;
            b.dataset.system = srcBtn.dataset.system;
            fpSys.appendChild(b);
        });

        // 參數組小按鈕(基準版/特化版;代理點擊頁首隱藏的參數頁籤)
        const fpConfig = panel.querySelector('#fp-config');
        knownConfigs.forEach(cfg => {
            const b = document.createElement('button');
            b.textContent = CONFIG_LABELS[cfg] || cfg;
            b.dataset.config = cfg;
            fpConfig.appendChild(b);
        });

        // 按鈕列一律代理點擊頁首的隱藏按鈕(狀態單一來源)
        const proxy = [
            ['#fp-run button', 'run', '.run-btn'],
            ['#fp-dist button', 'dist', '.dist-btn'],
            ['#fp-sys button', 'system', '.sys-btn'],
            ['#fp-config button', 'config', '.tab-btn'],
            ['#fp-windef button', 'windef', '.windef-btn'],
        ];
        for (const [sel, key, srcSel] of proxy) {
            panel.querySelectorAll(sel).forEach(b => {
                b.addEventListener('click', () => {
                    document.querySelector(`${srcSel}[data-${key}="${b.dataset[key]}"]`)?.click();
                    setTimeout(syncFloatingPanel, 0);
                });
            });
        }
        panel.querySelector('#fp-rounds').addEventListener('change', (e) => {
            const target = document.querySelector(`.rounds-btn[data-rounds="${e.target.value}"]`);
            if (target) target.click();
        });

        // BET 過濾器:開/關各注額的統計(非代理按鈕,狀態即 activeBets;至少保留一個)
        panel.querySelectorAll('#fp-bets button').forEach(b => {
            b.addEventListener('click', () => {
                const bet = parseInt(b.dataset.bet);
                if (activeBets.has(bet)) {
                    if (activeBets.size === 1) return; // 全關沒有意義,擋下最後一個
                    activeBets.delete(bet);
                } else {
                    activeBets.add(bet);
                }
                localStorage.setItem('pas005_bets', JSON.stringify([...activeBets]));
                syncFloatingPanel();
                if (rawData.length > 0) applyRoundLimit();
            });
        });

        fab.addEventListener('click', () => {
            const opening = panel.style.display !== 'block';
            panel.style.display = opening ? 'block' : 'none';
            if (opening) syncFloatingPanel();
        });
        panel.querySelector('#fp-close').addEventListener('click', () => {
            panel.style.display = 'none';
        });

        // 頁首控制列已隱藏,懸浮按鈕常駐顯示;首次載入直接展開面板方便發現
        fab.style.display = 'flex';
        panel.style.display = 'block';

        // 使用者直接點頁首按鈕時,同步面板顯示狀態
        document.addEventListener('click', (e) => {
            if (e.target.closest('.sys-btn, .tab-btn')) {
                setTimeout(syncFloatingPanel, 0);
            }
        });

        syncFloatingPanel();
    }

    function syncFloatingPanel() {
        const panel = document.getElementById('floating-switcher');
        if (!panel) return;

        // 按鈕列:依頁首隱藏按鈕的 active 狀態同步
        const groups = [
            ['#fp-run button', 'run', '.run-btn.active'],
            ['#fp-dist button', 'dist', '.dist-btn.active'],
            ['#fp-sys button', 'system', '.sys-btn.active[data-system]'],
            ['#fp-config button', 'config', '.tab-btn.active'],
            ['#fp-windef button', 'windef', '.windef-btn.active'],
        ];
        for (const [sel, key, activeSel] of groups) {
            const active = document.querySelector(activeSel);
            panel.querySelectorAll(sel).forEach(b => {
                b.classList.toggle('active', !!active && b.dataset[key] === active.dataset[key]);
            });
        }

        const activeRounds = document.querySelector('.rounds-btn.active');
        if (activeRounds) panel.querySelector('#fp-rounds').value = activeRounds.dataset.rounds;

        // BET 過濾器:依 activeBets 同步(開 = 亮)
        panel.querySelectorAll('#fp-bets button').forEach(b => {
            b.classList.toggle('active', activeBets.has(parseInt(b.dataset.bet)));
        });
    }

    // 統計區塊收合(記住使用者上次的開合狀態)
    initCollapsibleSections();

    // 網頁載入時立刻嘗試自動讀取
    tryAutoLoad();

    // 顆粒度選擇:記錄在 localStorage,下次開頁還原
    function bindBinSelect(id, storageKey, redraw) {
        const sel = document.getElementById(id);
        if (!sel) return;
        const saved = localStorage.getItem(storageKey);
        if (saved && [...sel.options].some(o => o.value === saved)) sel.value = saved;
        sel.addEventListener('change', () => {
            try { localStorage.setItem(storageKey, sel.value); } catch (e) {}
            if (globalData && globalData.length > 0) redraw(globalData);
        });
    }
    bindBinSelect('rtp-bin-size', 'pas005_rtp_bin', drawRtpDistributionChart);
    bindBinSelect('mult-bin-size', 'pas005_mult_bin', drawMultDistChart);
});

// ==================== 統計區塊收合(狀態存 localStorage,下次開頁還原) ====================
function initCollapsibleSections() {
    const KEY = 'pas005_sections_collapsed';
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { saved = {}; }

    restoreSectionOrder(); // 先按上次儲存的順序重排,再包收合結構

    document.querySelectorAll('[data-sec]').forEach(sec => {
        const id = sec.dataset.sec;
        const title = sec.dataset.title || (sec.querySelector('h2')?.textContent.trim()) || id;

        const head = document.createElement('div');
        head.className = 'sec-head';
        head.title = '點擊收合 / 展開';
        head.innerHTML = `<span class="sec-arrow">▾</span><span>${title}</span><span class="sec-drag" title="按住拖曳調整區塊順序">⠿</span>`;
        initSectionDrag(head.querySelector('.sec-drag'), sec);

        const body = document.createElement('div');
        body.className = 'sec-body';
        while (sec.firstChild) body.appendChild(sec.firstChild);
        sec.appendChild(head);
        sec.appendChild(body);

        // 內部首個 h2 與收合標題重複時移除,避免雙標題
        const h2 = body.querySelector('h2');
        if (h2 && h2.textContent.trim() === title) h2.remove();

        sec.classList.toggle('collapsed', !!saved[id]);

        head.addEventListener('click', () => {
            const collapsed = !sec.classList.contains('collapsed');
            sec.classList.toggle('collapsed', collapsed);
            saved[id] = collapsed;
            try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch (e) {}
            if (!collapsed) window.dispatchEvent(new Event('resize')); // 展開時讓 Chart.js 重算尺寸
        });
    });
}

// ==================== 統計區塊拖曳排序(順序存 localStorage) ====================
const SEC_ORDER_KEY = 'pas005_sections_order';

// 依上次儲存的順序重排區塊;沒記錄過的新區塊排在已知區塊之後
function restoreSectionOrder() {
    let order = [];
    try { order = JSON.parse(localStorage.getItem(SEC_ORDER_KEY)) || []; } catch (e) { return; }
    if (!order.length) return;

    const secs = [...document.querySelectorAll('[data-sec]')];
    if (!secs.length) return;
    const parent = secs[0].parentNode;
    const map = {};
    secs.forEach(s => map[s.dataset.sec] = s);

    const desired = order.filter(id => map[id]).map(id => map[id]);
    secs.forEach(s => { if (!desired.includes(s)) desired.push(s); });

    const marker = document.createComment('sec-order-marker');
    parent.insertBefore(marker, secs[0]);
    desired.forEach(s => parent.insertBefore(s, marker));
    parent.removeChild(marker);
}

function saveSectionOrder() {
    const order = [...document.querySelectorAll('[data-sec]')].map(s => s.dataset.sec);
    try { localStorage.setItem(SEC_ORDER_KEY, JSON.stringify(order)); } catch (e) {}
}

// 把手拖曳:跟隨滑鼠即時插入到對應位置,放開時存檔
function initSectionDrag(handle, sec) {
    handle.addEventListener('click', e => e.stopPropagation()); // 不觸發收合
    handle.addEventListener('mousedown', e => {
        e.preventDefault();
        e.stopPropagation();
        const parent = sec.parentNode;
        sec.classList.add('dragging');
        document.body.style.userSelect = 'none';

        const onMove = ev => {
            const others = [...parent.querySelectorAll('[data-sec]')].filter(s => s !== sec);
            let target = null;
            for (const s of others) {
                const r = s.getBoundingClientRect();
                if (ev.clientY < r.top + r.height / 2) { target = s; break; }
            }
            if (target) {
                parent.insertBefore(sec, target);
            } else if (others.length) {
                const last = others[others.length - 1];
                parent.insertBefore(sec, last.nextSibling);
            }
        };
        const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            sec.classList.remove('dragging');
            document.body.style.userSelect = '';
            saveSectionOrder();
            window.dispatchEvent(new Event('resize')); // 圖表重算尺寸
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    });
}

function processData(data) {
    let totalBetAll = 0;
    let totalReturnAll = 0;

    // HITRATE / WINRATE 摘要 (固定定義,不受勝定義切換影響)
    let totalPlaysAll = 0;
    let totalHits = 0;      // win > 0
    let totalWinHits = 0;   // win >= bet
    let hasWinField = false;

    // 用於圖表：依據 betAmount 分組記錄每一局的勝負
    const betGroups = {};

    data.forEach(player => {
        const totalBet = player.betAmount * player.totalPlays;
        const totalReturn = totalBet + player.finalBalance;

        totalBetAll += totalBet;
        totalReturnAll += totalReturn;

        player.rtp = (totalReturn / totalBet) * 100;

        // 預先計算每個人的最大連贏/連輸與最大單局倍率
        let maxWinStreak = 0;
        let currentWinStreak = 0;
        let maxLossStreak = 0;
        let currentLossStreak = 0;
        let maxWinMult = 0;

        player.history.forEach(round => {
            if (isWin(round, player.betAmount)) {
                currentWinStreak++;
                currentLossStreak = 0;
                if (currentWinStreak > maxWinStreak) maxWinStreak = currentWinStreak;
            } else {
                currentLossStreak++;
                currentWinStreak = 0;
                if (currentLossStreak > maxLossStreak) maxLossStreak = currentLossStreak;
            }

            if (round.win !== undefined) {
                hasWinField = true;
                if (round.win > 0) totalHits++;
                if (round.win >= player.betAmount) totalWinHits++;
                const mult = round.win / player.betAmount;
                if (mult > maxWinMult) maxWinMult = mult;
            }
            totalPlaysAll++;

        });

        player.maxWin = maxWinStreak;
        player.maxLoss = maxLossStreak;
        player.maxWinMult = maxWinMult;

        // 統計各 BET 群組的勝率與 RTP
        if (!betGroups[player.betAmount]) {
            betGroups[player.betAmount] = {
                players: 0,
                totalBet: 0,
                totalReturn: 0,
                rounds: []
            };
        }

        betGroups[player.betAmount].players++;
        betGroups[player.betAmount].totalBet += totalBet;
        betGroups[player.betAmount].totalReturn += totalReturn;

        player.history.forEach(roundData => {
            const rIdx = roundData.round - 1;
            if (!betGroups[player.betAmount].rounds[rIdx]) {
                betGroups[player.betAmount].rounds[rIdx] = { wins: 0, total: 0, totalChange: 0 };
            }
            if (isWin(roundData, player.betAmount)) {
                betGroups[player.betAmount].rounds[rIdx].wins++;
            }
            betGroups[player.betAmount].rounds[rIdx].total++;
            betGroups[player.betAmount].rounds[rIdx].totalChange += roundData.change;
        });
    });

    // 更新上方的 Summary 卡片
    document.getElementById("total-players").textContent = data.length;
    const overallRtp = (totalReturnAll / totalBetAll) * 100;
    document.getElementById("overall-rtp").textContent = overallRtp.toFixed(2) + "%";
    document.getElementById("overall-hitrate").textContent =
        hasWinField && totalPlaysAll > 0 ? (totalHits / totalPlaysAll * 100).toFixed(2) + "%" : "--";
    document.getElementById("overall-winrate").textContent =
        hasWinField && totalPlaysAll > 0 ? (totalWinHits / totalPlaysAll * 100).toFixed(2) + "%" : "--";

    // 渲染表格與設定排序
    renderTable();
    setupSorting();

    // 準備 Chart.js 所需資料
    let maxRounds = 0;
    for (const bet in betGroups) {
        if (betGroups[bet].rounds.length > maxRounds) {
            maxRounds = betGroups[bet].rounds.length;
        }
    }

    const labels = Array.from({length: maxRounds}, (_, i) => `局數 ${i + 1}`);

    const winRateDatasets = [];
    const rtpRoundDatasets = [];

    const summaryLabels = [];
    const summaryWinRates = [];
    const summaryRtps = [];
    const summaryBgColors1 = [];
    const summaryBorderColors1 = [];
    const summaryBgColors2 = [];
    const summaryBorderColors2 = [];

    const overallRounds = [];
    let overallTotalWins = 0;
    let overallTotalPlays = 0;

    let colorIdx = 0;

    for (const betStr in betGroups) {
        const bet = parseFloat(betStr);
        const group = betGroups[bet];

        let groupTotalWins = 0;
        let groupTotalPlays = 0;

        const winRateDataPoints = [];
        const rtpRoundDataPoints = [];

        group.rounds.forEach((r, idx) => {
            if (!overallRounds[idx]) overallRounds[idx] = { wins: 0, total: 0, totalChange: 0, totalBet: 0 };
            if (r) {
                overallRounds[idx].wins += r.wins;
                overallRounds[idx].total += r.total;
                overallRounds[idx].totalChange += r.totalChange;
                overallRounds[idx].totalBet += (r.total * bet);

                groupTotalWins += r.wins;
                groupTotalPlays += r.total;

                winRateDataPoints.push(r.total > 0 ? (r.wins / r.total) * 100 : 0);

                const roundTotalBet = r.total * bet;
                const roundTotalReturn = roundTotalBet + r.totalChange;
                rtpRoundDataPoints.push(roundTotalBet > 0 ? (roundTotalReturn / roundTotalBet) * 100 : 0);
            } else {
                winRateDataPoints.push(0);
                rtpRoundDataPoints.push(0);
            }
        });

        overallTotalWins += groupTotalWins;
        overallTotalPlays += groupTotalPlays;

        const color = getGroupColorHex(bet, colorIdx);

        winRateDatasets.push({
            label: `Bet $${bet} (${group.players}人)`,
            data: winRateDataPoints,
            borderColor: color,
            backgroundColor: color + '33',
            borderWidth: 2,
            pointRadius: 2,
            fill: false,
            tension: 0.3
        });

        rtpRoundDatasets.push({
            label: `Bet $${bet} (${group.players}人)`,
            data: rtpRoundDataPoints,
            borderColor: color,
            backgroundColor: color + '33',
            borderWidth: 2,
            pointRadius: 2,
            fill: false,
            tension: 0.3
        });

        const groupRtp = (group.totalReturn / group.totalBet) * 100;
        const groupWinRate = groupTotalPlays > 0 ? (groupTotalWins / groupTotalPlays) * 100 : 0;

        summaryLabels.push(`Bet $${bet}`);
        summaryWinRates.push(groupWinRate);
        summaryRtps.push(groupRtp);

        summaryBgColors1.push(color + '88');
        summaryBorderColors1.push(color);
        summaryBgColors2.push(color + 'CC');
        summaryBorderColors2.push(color);

        colorIdx++;
    }

    // Overall Summary
    summaryLabels.push('所有 BET 總計');
    const grandWinRate = overallTotalPlays > 0 ? (overallTotalWins / overallTotalPlays) * 100 : 0;
    summaryWinRates.push(grandWinRate);
    summaryRtps.push(overallRtp);

    summaryBgColors1.push('rgba(255, 255, 255, 0.4)');
    summaryBorderColors1.push('#ffffff');
    summaryBgColors2.push('rgba(255, 255, 255, 0.8)');
    summaryBorderColors2.push('#ffffff');

    if (currentChart) currentChart.destroy();
    if (currentRtpRoundChart) currentRtpRoundChart.destroy();
    if (currentSummaryBarChart) currentSummaryBarChart.destroy();

    const chartOptions = {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
            tooltip: { callbacks: { label: function(context) { return context.dataset.label + ': ' + context.parsed.y.toFixed(2) + '%'; } } },
            legend: { labels: { color: '#f8fafc', font: { family: 'Inter', size: 13 } } }
        },
        scales: {
            x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8' } },
            y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8', callback: function(value) { return value + '%'; } } }
        }
    };

    // 1. 繪製勝率折線圖
    const ctxWin = document.getElementById('winRateChart').getContext('2d');
    currentChart = new Chart(ctxWin, {
        type: 'line',
        data: { labels: labels, datasets: winRateDatasets },
        options: chartOptions
    });

    // 2. 繪製每局 RTP 折線圖
    const ctxRtpRound = document.getElementById('rtpRoundChart').getContext('2d');
    currentRtpRoundChart = new Chart(ctxRtpRound, {
        type: 'line',
        data: { labels: labels, datasets: rtpRoundDatasets },
        options: chartOptions
    });

    // 3. 繪製總體平均勝率 與 平均 RTP (長條圖)
    const ctxSummary = document.getElementById('summaryBarChart').getContext('2d');
    currentSummaryBarChart = new Chart(ctxSummary, {
        type: 'bar',
        data: {
            labels: summaryLabels,
            datasets: [
                {
                    label: '平均勝率 (%)',
                    data: summaryWinRates,
                    backgroundColor: summaryBgColors1,
                    borderColor: summaryBorderColors1,
                    borderWidth: 2,
                    borderRadius: 4
                },
                {
                    label: '平均 RTP (%)',
                    data: summaryRtps,
                    backgroundColor: summaryBgColors2,
                    borderColor: summaryBorderColors2,
                    borderWidth: 2,
                    borderRadius: 4
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { labels: { color: '#f8fafc' } },
                tooltip: { callbacks: { label: function(context) { return context.dataset.label + ': ' + context.raw.toFixed(2) + '%'; } } }
            },
            scales: {
                x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8' } },
                y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8', callback: function(value) { return value + '%'; } } }
            }
        }
    });

    // 4. 繪製最終玩家 RTP 分布圖
    drawRtpDistributionChart(data);

    // 4.5 單局倍率分布(各區間占全體局數%)
    drawMultDistChart(data);

    // 5. 繪製最終連贏連輸分布圖
    drawStreakDistributionCharts(data);

    // 5.5 連贏/連輸「次數」分布圖 (每段連段長度的出現次數 ÷ 全體總局數)
    drawStreakRunCharts(data);

    // 6. 連段統計表 (固定格 + 等稀有度門檻)
    renderStreakStats(data);

    // 6.5 特色統計 (RS / LW 平均倍率,依 BET 分群)
    renderFeatureStats(data);

    // 7. 渲染表格
    renderTable();
}

function drawStreakDistributionCharts(data) {
    if (currentMaxWinDistChart) {
        currentMaxWinDistChart.destroy();
        currentMaxWinDistChart = null;
    }
    if (currentMaxLossDistChart) {
        currentMaxLossDistChart.destroy();
        currentMaxLossDistChart = null;
    }

    const validData = data.filter(p => !isNaN(p.maxWin) && !isNaN(p.maxLoss));
    if (validData.length === 0) return;

    const globalMaxWin = Math.max(...validData.map(p => p.maxWin), 0);
    const globalMaxLoss = Math.max(...validData.map(p => p.maxLoss), 0);

    const winLabels = Array.from({length: globalMaxWin + 1}, (_, i) => `${i}局`);
    const lossLabels = Array.from({length: globalMaxLoss + 1}, (_, i) => `${i}局`);

    const betGroups = {};
    validData.forEach(p => {
        if (!betGroups[p.betAmount]) {
            betGroups[p.betAmount] = {
                players: 0,
                winBins: Array(globalMaxWin + 1).fill(0),
                lossBins: Array(globalMaxLoss + 1).fill(0)
            };
        }
        betGroups[p.betAmount].players++;
        betGroups[p.betAmount].winBins[p.maxWin]++;
        betGroups[p.betAmount].lossBins[p.maxLoss]++;
    });

    const totalPlayers = validData.length;
    const winDatasets = [];
    const lossDatasets = [];
    let colorIdx = 0;

    for (const betStr in betGroups) {
        const bet = parseFloat(betStr);
        const group = betGroups[bet];

        const winPercentages = group.winBins.map(count => (count / totalPlayers) * 100);
        const lossPercentages = group.lossBins.map(count => (count / totalPlayers) * 100);

        const hexColor = getGroupColorHex(bet, colorIdx);
        const bgRgba = hexToRgba(hexColor, 0.7);
        const borderRgba = hexToRgba(hexColor, 1.0);

        winDatasets.push({
            label: `Bet $${bet} (${group.players}人)`,
            data: winPercentages,
            backgroundColor: bgRgba,
            borderColor: borderRgba,
            borderWidth: 1,
            stack: 'Stack 0',
            _rawCounts: group.winBins
        });

        lossDatasets.push({
            label: `Bet $${bet} (${group.players}人)`,
            data: lossPercentages,
            backgroundColor: bgRgba,
            borderColor: borderRgba,
            borderWidth: 1,
            stack: 'Stack 0',
            _rawCounts: group.lossBins
        });

        colorIdx++;
    }

    const streakChartOptions = (xTitle) => ({
        responsive: true,
        maintainAspectRatio: false,
        scales: {
            y: {
                stacked: true,
                beginAtZero: true,
                grid: { color: 'rgba(255,255,255,0.05)' },
                ticks: { color: '#94a3b8' },
                title: { display: true, text: '總佔比 (%)', color: '#94a3b8' }
            },
            x: {
                stacked: true,
                grid: { color: 'rgba(255,255,255,0.05)' },
                ticks: { color: '#94a3b8' },
                title: { display: true, text: xTitle, color: '#94a3b8' }
            }
        },
        plugins: {
            legend: { labels: { color: '#f8fafc' } },
            tooltip: {
                callbacks: {
                    label: function(context) {
                        const count = context.dataset._rawCounts[context.dataIndex];
                        return `${context.dataset.label.split(' ')[0]} ${context.dataset.label.split(' ')[1]}: 佔比 ${context.parsed.y.toFixed(2)}% (${count}人)`;
                    }
                }
            }
        }
    });

    const winCtx = document.getElementById('maxWinDistributionChart');
    if (winCtx) {
        currentMaxWinDistChart = new Chart(winCtx.getContext('2d'), {
            type: 'bar',
            data: { labels: winLabels, datasets: winDatasets },
            options: streakChartOptions('最大連贏局數')
        });
    }

    const lossCtx = document.getElementById('maxLossDistributionChart');
    if (lossCtx) {
        currentMaxLossDistChart = new Chart(lossCtx.getContext('2d'), {
            type: 'bar',
            data: { labels: lossLabels, datasets: lossDatasets },
            options: streakChartOptions('最大連輸局數')
        });
    }
}

// 單局倍率分布:每局總贏分倍率落在各區間的占比(分母 = 全體局數)
// 顆粒度由 #mult-bin-size 自訂(預設 1 倍);超過 50 格的尾巴收進「N+」溢位格
function drawMultDistChart(data) {
    if (currentMultDistChart) { currentMultDistChart.destroy(); currentMultDistChart = null; }
    const ctx = document.getElementById('multDistChart');
    if (!ctx) return;

    const binSel = document.getElementById('mult-bin-size');
    const binSize = binSel ? parseFloat(binSel.value) : 1;

    // 全區間不聚合:格數蓋到最大倍率,寬度不夠時外層橫向卷軸
    let maxMult = 0;
    data.forEach(p => p.history.forEach(r => {
        const m = r.win / p.betAmount;
        if (m > maxMult) maxMult = m;
    }));
    const fullBins = Math.max(1, Math.ceil((maxMult + 1e-9) / binSize));
    const nBins = 1 + fullBins; // [0(沒中)] + 區間格

    const fmtB = v => (v % 1 === 0 ? v : v.toFixed(1));
    const labels = ['0(沒中)'];
    for (let i = 0; i < fullBins; i++) labels.push(`${fmtB(i * binSize)}~${fmtB((i + 1) * binSize)}`);

    const betGroups = {};
    let totalRounds = 0;
    data.forEach(p => {
        const g = betGroups[p.betAmount] ??= { players: 0, bins: new Array(nBins).fill(0), plays: 0 };
        g.players++;
        p.history.forEach(r => {
            totalRounds++;
            g.plays++;
            let idx = 0;
            if (r.win > 0) {
                const m = r.win / p.betAmount;
                idx = Math.min(1 + Math.floor(m / binSize), nBins - 1);
            }
            g.bins[idx]++;
        });
    });

    // 依格數撐開內層寬度(每格 ≥26px),外層 overflow-x 捲動
    const inner = document.getElementById('multDistInner');
    if (inner) {
        const outerW = inner.parentElement.clientWidth || 1000;
        inner.style.width = Math.max(outerW, nBins * 26) + 'px';
    }
    const datasets = [];
    let colorIdx = 0;
    for (const betStr of Object.keys(betGroups).sort((a, b) => a - b)) {
        const bet = parseFloat(betStr);
        const g = betGroups[bet];
        const hexColor = getGroupColorHex(bet, colorIdx);
        datasets.push({
            label: `Bet $${bet} (${g.players}人)`,
            data: g.bins.map(c => c / totalRounds * 100),
            backgroundColor: hexToRgba(hexColor, 0.7),
            borderColor: hexToRgba(hexColor, 1.0),
            borderWidth: 1,
            stack: 'Stack 0',
            _rawCounts: g.bins,
            _groupPlays: g.plays,
            _denom: totalRounds
        });
        colorIdx++;
    }

    currentMultDistChart = new Chart(ctx.getContext('2d'), {
        type: 'bar',
        data: { labels, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    stacked: true, beginAtZero: true,
                    grid: { color: 'rgba(255,255,255,0.05)' },
                    ticks: { color: '#94a3b8' },
                    title: { display: true, text: '佔全體局數 (%)', color: '#94a3b8' }
                },
                x: {
                    stacked: true,
                    grid: { color: 'rgba(255,255,255,0.05)' },
                    ticks: { color: '#94a3b8' },
                    title: { display: true, text: '單局總贏分倍率區間', color: '#94a3b8' }
                }
            },
            plugins: {
                legend: { labels: { color: '#f8fafc' } },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const count = context.dataset._rawCounts[context.dataIndex];
                            const denom = context.dataset._denom;
                            const gp = context.dataset._groupPlays;
                            return `${context.dataset.label.split(' ')[0]} ${context.dataset.label.split(' ')[1]}: ${context.parsed.y.toFixed(3)}% (${count}/${denom},佔該BET ${(count / gp * 100).toFixed(2)}%)`;
                        }
                    }
                }
            }
        }
    });
}

// 連贏/連輸「次數」分布:掃出每一段連續贏(輸)的長度,
// 每個長度的出現次數 ÷ 全體玩家總局數;tooltip 顯示分子/分母
function drawStreakRunCharts(data) {
    if (currentWinRunChart) { currentWinRunChart.destroy(); currentWinRunChart = null; }
    if (currentLossRunChart) { currentLossRunChart.destroy(); currentLossRunChart = null; }

    // betGroups[bet] = { winRuns: {len: count}, lossRuns: {len: count} }
    const betGroups = {};
    let totalRounds = 0;
    let maxWinLen = 0, maxLossLen = 0;

    data.forEach(p => {
        totalRounds += p.history.length;
        const g = betGroups[p.betAmount] ??= { players: 0, winRuns: {}, lossRuns: {} };
        g.players++;
        let cur = 0, curIsWin = null;
        const flush = () => {
            if (curIsWin === null) return;
            const runs = curIsWin ? g.winRuns : g.lossRuns;
            runs[cur] = (runs[cur] || 0) + 1;
            if (curIsWin) maxWinLen = Math.max(maxWinLen, cur);
            else maxLossLen = Math.max(maxLossLen, cur);
        };
        p.history.forEach(r => {
            const w = isWin(r, p.betAmount);
            if (curIsWin === null) { curIsWin = w; cur = 1; }
            else if (w === curIsWin) { cur++; }
            else { flush(); curIsWin = w; cur = 1; }
        });
        flush();
    });

    const makeChart = (canvasId, kindKey, maxLen, xTitle) => {
        const ctx = document.getElementById(canvasId);
        if (!ctx || maxLen === 0) return null;
        const labels = Array.from({ length: maxLen }, (_, i) => `${i + 1}局`);
        const datasets = [];
        let colorIdx = 0;
        for (const betStr of Object.keys(betGroups).sort((a, b) => a - b)) {
            const bet = parseFloat(betStr);
            const runs = betGroups[bet][kindKey];
            const counts = Array.from({ length: maxLen }, (_, i) => runs[i + 1] || 0);
            const hexColor = getGroupColorHex(bet, colorIdx);
            datasets.push({
                label: `Bet $${bet} (${betGroups[bet].players}人)`,
                data: counts.map(c => c / totalRounds * 100),
                backgroundColor: hexToRgba(hexColor, 0.7),
                borderColor: hexToRgba(hexColor, 1.0),
                borderWidth: 1,
                stack: 'Stack 0',
                _rawCounts: counts,
                _denom: totalRounds
            });
            colorIdx++;
        }
        return new Chart(ctx.getContext('2d'), {
            type: 'bar',
            data: { labels, datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: {
                        stacked: true, beginAtZero: true,
                        grid: { color: 'rgba(255,255,255,0.05)' },
                        ticks: { color: '#94a3b8' },
                        title: { display: true, text: '佔全體局數 (%)', color: '#94a3b8' }
                    },
                    x: {
                        stacked: true,
                        grid: { color: 'rgba(255,255,255,0.05)' },
                        ticks: { color: '#94a3b8' },
                        title: { display: true, text: xTitle, color: '#94a3b8' }
                    }
                },
                plugins: {
                    legend: { labels: { color: '#f8fafc' } },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                const count = context.dataset._rawCounts[context.dataIndex];
                                const denom = context.dataset._denom;
                                return `${context.dataset.label.split(' ')[0]} ${context.dataset.label.split(' ')[1]}: ${context.parsed.y.toFixed(3)}% (${count}/${denom})`;
                            }
                        }
                    }
                }
            }
        });
    };

    currentWinRunChart = makeChart('winRunChart', 'winRuns', maxWinLen, '連贏長度 (局)');
    currentLossRunChart = makeChart('lossRunChart', 'lossRuns', maxLossLen, '連輸長度 (局)');
}

// 特色統計:各 BET 的 RS / LW 觸發次數、觸發率、平均倍率、首次出現(每位玩家第一次的平均轉數與範圍)
function renderFeatureStats(data) {
    const table = document.getElementById('feature-stats-table');
    if (!table) return;

    const groups = {};
    data.forEach(p => {
        const g = groups[p.betAmount] ??= { plays: 0, rsN: 0, rsMultSum: 0, lwN: 0, lwMultSum: 0,
                                            firstRS: [], firstLW: [], noRS: 0, noLW: 0 };
        let fRS = null, fLW = null;
        p.history.forEach((r, i) => {
            g.plays++;
            const mult = r.win / p.betAmount;
            if (r.special === 'RS') { g.rsN++; g.rsMultSum += mult; if (fRS === null) fRS = i + 1; }
            else if (r.special === 'LW') { g.lwN++; g.lwMultSum += mult; if (fLW === null) fLW = i + 1; }
        });
        if (fRS === null) g.noRS++; else g.firstRS.push(fRS);
        if (fLW === null) g.noLW++; else g.firstLW.push(fLW);
    });

    // 首次出現:平均第幾轉(範圍 最小~最大);有玩家全程未出現時附註人數
    const firstText = (list, noneCnt) => {
        if (!list.length) return '-';
        const mean = list.reduce((s, v) => s + v, 0) / list.length;
        let t = `第 ${mean.toFixed(1)} 轉 (${Math.min(...list)}~${Math.max(...list)})`;
        if (noneCnt) t += `,${noneCnt} 人未出現`;
        return t;
    };

    table.querySelector('thead').innerHTML = `
        <tr>
            <th>BET</th><th>總局數</th>
            <th>RS 次數</th><th>RS 觸發率%</th><th>RS 平均倍率</th><th title="每位玩家第一次 RS 出現在第幾轉的平均與範圍">首次 RS</th>
            <th>LW 次數</th><th>LW 觸發率%</th><th>LW 平均倍率</th><th title="每位玩家第一次 LW 出現在第幾轉的平均與範圍">首次 LW</th>
        </tr>`;
    const tbody = table.querySelector('tbody');
    tbody.innerHTML = '';
    Object.keys(groups).map(Number).sort((a, b) => a - b).forEach(bet => {
        const g = groups[bet];
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>$${bet}</td><td>${g.plays}</td>
            <td>${g.rsN}</td>
            <td>${(g.rsN / g.plays * 100).toFixed(2)}</td>
            <td class="${g.rsN ? 'positive' : ''}">${g.rsN ? (g.rsMultSum / g.rsN).toFixed(2) + 'x' : '-'}</td>
            <td>${firstText(g.firstRS, g.noRS)}</td>
            <td>${g.lwN}</td>
            <td>${(g.lwN / g.plays * 100).toFixed(2)}</td>
            <td class="${g.lwN ? 'positive' : ''}">${g.lwN ? (g.lwMultSum / g.lwN).toFixed(2) + 'x' : '-'}</td>
            <td>${firstText(g.firstLW, g.noLW)}</td>
        `;
        tbody.appendChild(tr);
    });
}

// 連段統計表:各 BET 的平均最大連段、固定格 5/10/15/20 佔比、等稀有度門檻佔比
function renderStreakStats(data) {
    const table = document.getElementById('streak-stats-table');
    if (!table) return;

    const GRID = [5, 10, 15, 20];
    const betGroups = {};
    data.forEach(p => {
        if (!betGroups[p.betAmount]) {
            betGroups[p.betAmount] = { players: 0, wins: 0, plays: 0, maxLosses: [], maxWins: [] };
        }
        const g = betGroups[p.betAmount];
        g.players++;
        g.maxLosses.push(p.maxLoss);
        g.maxWins.push(p.maxWin);
        p.history.forEach(r => {
            g.plays++;
            if (isWin(r, p.betAmount)) g.wins++;
        });
    });

    const pctGE = (arr, th) => (arr.filter(v => v >= th).length / arr.length * 100).toFixed(1);
    const avg = arr => (arr.reduce((s, v) => s + v, 0) / arr.length).toFixed(2);

    table.querySelector('thead').innerHTML = `
        <tr>
            <th>BET</th><th>人數</th><th>勝率%</th>
            <th>平均最大連輸</th>
            ${GRID.map(g => `<th>連輸≥${g}%</th>`).join('')}
            <th>罕見連輸 (&lt;0.4%)</th><th>極罕見連輸 (&lt;0.1%)</th>
            <th>平均最大連贏</th>
            ${GRID.map(g => `<th>連贏≥${g}%</th>`).join('')}
        </tr>`;

    const tbody = table.querySelector('tbody');
    tbody.innerHTML = '';
    Object.keys(betGroups).map(Number).sort((a, b) => a - b).forEach(bet => {
        const g = betGroups[bet];
        const p = g.plays > 0 ? g.wins / g.plays : 0;
        const L8 = eqRarityThreshold(p, 8);
        const L10 = eqRarityThreshold(p, 10);
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>$${bet}</td><td>${g.players}</td><td>${(p * 100).toFixed(2)}</td>
            <td>${avg(g.maxLosses)}</td>
            ${GRID.map(gr => `<td>${pctGE(g.maxLosses, gr)}</td>`).join('')}
            <td>≥${L8}:${pctGE(g.maxLosses, L8)}%</td>
            <td>≥${L10}:${pctGE(g.maxLosses, L10)}%</td>
            <td class="positive">${avg(g.maxWins)}</td>
            ${GRID.map(gr => `<td>${pctGE(g.maxWins, gr)}</td>`).join('')}
        `;
        tbody.appendChild(tr);
    });
}

function drawRtpDistributionChart(data) {
    if (currentRtpDistChart) {
        currentRtpDistChart.destroy();
        currentRtpDistChart = null;
    }

    const binSizeSelect = document.getElementById('rtp-bin-size');
    const binSize = binSizeSelect ? parseFloat(binSizeSelect.value) : 1;

    const validData = data.filter(p => !isNaN(p.rtp) && isFinite(p.rtp));
    if (validData.length === 0) return;

    const rtps = validData.map(p => p.rtp);
    const minRtp = Math.floor(Math.min(...rtps) / binSize) * binSize;
    const maxRtp = Math.ceil(Math.max(...rtps) / binSize) * binSize;

    const numBins = Math.ceil((maxRtp - minRtp) / binSize) + 1;
    const binLabels = [];
    for (let current = minRtp; current <= maxRtp; current += binSize) {
        binLabels.push(`${current.toFixed(1)}~${(current + binSize).toFixed(1)}%`);
    }

    const betGroups = {};
    validData.forEach(p => {
        if (!betGroups[p.betAmount]) {
            betGroups[p.betAmount] = { players: 0, bins: Array(numBins).fill(0) };
        }
        betGroups[p.betAmount].players++;

        let index = Math.floor((p.rtp - minRtp) / binSize);
        if (index >= numBins) index = numBins - 1;
        if (index < 0) index = 0;
        betGroups[p.betAmount].bins[index]++;
    });

    const totalPlayers = validData.length;
    const datasets = [];
    let colorIdx = 0;

    for (const betStr in betGroups) {
        const bet = parseFloat(betStr);
        const group = betGroups[bet];
        const percentages = group.bins.map(count => (count / totalPlayers) * 100);

        const hexColor = getGroupColorHex(bet, colorIdx);
        const bgRgba = hexToRgba(hexColor, 0.7);
        const borderRgba = hexToRgba(hexColor, 1.0);

        datasets.push({
            label: `Bet $${bet} (${group.players}人)`,
            data: percentages,
            backgroundColor: bgRgba,
            borderColor: borderRgba,
            borderWidth: 1,
            stack: 'Stack 0',
            _rawCounts: group.bins
        });
        colorIdx++;
    }

    const ctx = document.getElementById('rtpDistributionChart');
    if (!ctx) return;

    currentRtpDistChart = new Chart(ctx.getContext('2d'), {
        type: 'bar',
        data: {
            labels: binLabels,
            datasets: datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    stacked: true,
                    beginAtZero: true,
                    grid: { color: 'rgba(255,255,255,0.05)' },
                    ticks: { color: '#94a3b8' },
                    title: { display: true, text: '總佔比 (%)', color: '#94a3b8' }
                },
                x: {
                    stacked: true,
                    grid: { color: 'rgba(255,255,255,0.05)' },
                    ticks: { color: '#94a3b8' },
                    title: { display: true, text: 'RTP 區間', color: '#94a3b8' }
                }
            },
            plugins: {
                legend: { labels: { color: '#f8fafc' } },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const count = context.dataset._rawCounts[context.dataIndex];
                            return `${context.dataset.label.split(' ')[0]} ${context.dataset.label.split(' ')[1]}: 佔比 ${context.parsed.y.toFixed(2)}% (${count}人)`;
                        }
                    }
                }
            }
        }
    });
}

function renderTable() {
    const tbody = document.querySelector("#rtp-table tbody");
    tbody.innerHTML = '';

    globalData.forEach(player => {
        const tr = document.createElement("tr");
        const balanceClass = player.finalBalance > 0 ? 'positive' : (player.finalBalance < 0 ? 'negative' : '');

        tr.onclick = () => showPlayerDetails(player.playerId);

        tr.innerHTML = `
            <td>${player.playerId}</td>
            <td>$${player.betAmount}</td>
            <td>${player.totalPlays}</td>
            <td class="${balanceClass}">$${player.finalBalance > 0 ? '+' : ''}${player.finalBalance}</td>
            <td>${player.rtp.toFixed(2)}%</td>
            <td>${player.maxWinMult !== undefined ? player.maxWinMult.toFixed(1) + 'x' : '-'}</td>
            <td class="positive">${player.maxWin}</td>
            <td class="negative">${player.maxLoss}</td>
        `;
        tbody.appendChild(tr);
    });
}

function setupSorting() {
    const headers = document.querySelectorAll("th.sortable");
    headers.forEach(th => {
        // Remove old event listeners by cloning
        const newTh = th.cloneNode(true);
        th.parentNode.replaceChild(newTh, th);

        newTh.addEventListener('click', () => {
            const col = newTh.dataset.sort;

            if (currentSortCol === col) {
                currentSortAsc = !currentSortAsc;
            } else {
                currentSortCol = col;
                currentSortAsc = false; // 切換新欄位時預設降冪
            }

            document.querySelectorAll("th.sortable").forEach(h => {
                h.classList.remove('asc', 'desc');
            });
            newTh.classList.add(currentSortAsc ? 'asc' : 'desc');

            globalData.sort((a, b) => {
                let valA = a[col];
                let valB = b[col];

                // Player ID 特殊處理（自然排序，讓 G1_2 排在 G1_10 前面）
                if (col === 'playerId') {
                    const cmp = a.playerId.localeCompare(b.playerId, undefined, { numeric: true });
                    return currentSortAsc ? cmp : -cmp;
                }

                if (valA < valB) return currentSortAsc ? -1 : 1;
                if (valA > valB) return currentSortAsc ? 1 : -1;
                return 0;
            });

            renderTable();
        });
    });
}

// 盤面渲染:四個位置各一個淺底色格子,E = 空白;第四格特殊符號上色;
// RS/LW 的加抽結果(| 之後)以分隔線接續顯示
function renderBoard(board) {
    if (!board) return '-';
    const cell = (sym, extraClass = '') => {
        const text = sym === 'E' ? '' : sym;
        const cls = extraClass ? `board-cell ${extraClass}` : 'board-cell';
        return `<span class="${cls}">${text}</span>`;
    };
    const [main, extra] = board.split('|');
    const syms = main.trim().split(' ');
    let html = '<span class="board-cells">';
    syms.forEach((s, i) => {
        html += cell(s, (i === 3 && s !== 'E') ? 'special' : '');
    });
    if (extra !== undefined) {
        html += '<span class="board-sep">→</span>';
        const parts = extra.trim().split(' ');
        if (parts.length > 1) {
            parts.forEach(s => { html += cell(s); }); // Respin 盤面
        } else {
            html += cell(parts[0], 'special'); // 輪盤分數
        }
    }
    html += '</span>';
    return html;
}

function showPlayerDetails(playerId) {
    const player = globalData.find(p => p.playerId === playerId);
    if (!player) return;

    document.getElementById('modal-player-name').textContent = `玩家歷程: ${player.playerId}`;
    document.getElementById('modal-max-win').textContent = `${player.maxWin} 局`;
    document.getElementById('modal-max-loss').textContent = `${player.maxLoss} 局`;
    const maxMultEl = document.getElementById('modal-max-mult');
    if (maxMultEl) {
        maxMultEl.textContent = player.maxWinMult !== undefined ? `${player.maxWinMult.toFixed(1)}x` : '-';
    }

    const tbody = document.querySelector("#history-table tbody");
    tbody.innerHTML = '';

    // 詳細版(detail.html):歷程表追加進階欄位(一般版不進此分支)
    if (window.DETAIL_MODE) {
        const theadTr = document.querySelector('#history-table thead tr');
        if (theadTr && !theadTr.dataset.detail) {
            theadTr.dataset.detail = '1';
            theadTr.innerHTML += `<th title="來源編號(附註代碼)">來源</th>
                <th title="來源剩餘值">殘值</th>
                <th title="原始值(與實際不同時)">原值</th>
                <th title="重試次數">重試</th>`;
        }
    }

    player.history.forEach(round => {
        const tr = document.createElement('tr');
        const changeClass = round.change > 0 ? 'positive' : (round.change < 0 ? 'negative' : '');
        const changeText = round.change > 0 ? `+$${round.change}` : (round.change < 0 ? `-$${Math.abs(round.change)}` : '$0');

        const winText = round.win !== undefined ? `$${round.win}` : '-';
        let specialText = '-';
        if (round.special === 'RS') specialText = '🔁 Respin';
        else if (round.special === 'LW') specialText = '🎡 輪盤';

        const boardText = renderBoard(round.board);

        tr.innerHTML = `
            <td>${round.globalId || '-'}</td>
            <td>${round.round}</td>
            <td style="white-space: nowrap;">${boardText}</td>
            <td class="${round.win > 0 ? 'positive' : ''}">${winText}</td>
            <td class="${changeClass}">${changeText}</td>
            <td>$${round.balanceAfter}</td>
            <td>${specialText}</td>
        `;
        if (window.DETAIL_MODE) {
            const poolTxt = round.pool ? `${round.pool}${round.poolType || ''}` : '-';
            tr.innerHTML += `<td>${poolTxt}</td>
                <td>${round.pool && round.poolWater !== undefined ? round.poolWater : '-'}</td>
                <td class="negative">${round.origWin ? '$' + round.origWin : '-'}</td>
                <td>${round.rerolls || '-'}</td>`;
        }
        tbody.appendChild(tr);
    });

    document.getElementById('player-modal').style.display = 'block';
    document.body.style.overflow = 'hidden'; // 二級介面開啟時鎖住一級介面滾動
}
