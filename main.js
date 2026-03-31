let map;
let userMarker, accuracyCircle;
let portalMarkers = [];
let watchId, isFirstFix = true;
let currentUserPos = [33.4890, 126.4908];
let lastWalkPos = [33.4890, 126.4908];
let walkAccumulator = 0;
let forcedPortalId = null;
let lastEncounterId = null;
let activeScreen = 'main';
let currentMissionPortal = null;
let activeMissionPortalId = null;
let pendingConfirmationPortalId = null;
let ignoredPortalIds = new Set();
let encounterPending = false;
let autoHuntPortal = null; // 현재 자동사냥 중인 포탈 정보

// ===== 세션 사냥 기록 =====
let huntLog = { kills: 0, bossKills: 0, potions: 0, cardsGot: 0 };

// ===== WAKE LOCK — 백그라운드 유지 =====
let wakeLock = null;
async function requestWakeLock() {
    try {
        if ('wakeLock' in navigator) {
            wakeLock = await navigator.wakeLock.request('screen');
            console.log('[WAKELOCK] 화면 유지 활성화');
            wakeLock.addEventListener('release', () => { console.log('[WAKELOCK] 해제됨, 재획득 시도'); });
        }
    } catch(e) { console.log('[WAKELOCK] 실패:', e); }
}
// 화면 다시 활성화되면 즉시 wake lock 재획득
document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible' && !wakeLock) {
        await requestWakeLock();
    }
});

// ===== 백그라운드 오디오 트릭 — 화면 꺼져도 JS 실행 유지 =====
let bgAudioCtx = null;
function startBackgroundKeepAlive() {
    try {
        bgAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = bgAudioCtx.createOscillator();
        const gainNode = bgAudioCtx.createGain();
        gainNode.gain.value = 0.001; // 거의 무음
        oscillator.connect(gainNode);
        gainNode.connect(bgAudioCtx.destination);
        oscillator.start();
        console.log('[BG_AUDIO] 백그라운드 유지 오디오 시작');
    } catch(e) { console.log('[BG_AUDIO] 실패:', e); }
}

// SUPABASE CONNECTION
const SUPABASE_URL = "https://icggdzxzifbhegvdwzdc.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImljZ2dkenh6aWZiaGVndmR3emRjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ2MzE2NTQsImV4cCI6MjA5MDIwNzY1NH0.ceUvWu-78qaIxJcq490LUCUcwHS4NVCMYzL3YGemWjs";
const db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const DEFAULT_MONSTERS = [
    { name: "고블린 병사", hp: 100, dmg: 8, img: "goblin_soldier_tactical.png", type: "normal", hpMin:80,hpMax:120,atkMin:8,atkMax:14,defMin:0,defMax:3 },
    { name: "고블린 궁수", hp: 70, dmg: 12, img: "goblin_archer_cloak.png", type: "magic", hpMin:90,hpMax:140,atkMin:12,atkMax:20,defMin:2,defMax:5 },
    { name: "대왕 고블린", hp: 250, dmg: 18, img: "great_goblin_boss.png", type: "rare", hpMin:180,hpMax:280,atkMin:18,atkMax:30,defMin:5,defMax:12 }
];

async function getMonsterPool() {
    const { data } = await db.from('game_settings').select('value').eq('name', 'monsterPool').single();
    return data ? data.value : DEFAULT_MONSTERS;
}
async function getPlayerSettings() {
    const uid = currentUserId || 'singleton';
    const { data } = await db.from('player_state').select('*').eq('id', uid).single();
    return data || {"hp": 100, "atk": 20, "def": 10, "potions": 1};
}
async function getLootSettings() {
    const { data } = await db.from('game_settings').select('value').eq('name', 'lootSettings').single();
    return data ? data.value : {"chance": 0.3, "fixed": false};
}
async function getPortals() {
    const { data } = await db.from('portals').select('*');
    return data || [];
}

function parsePortalMonsters(raw) {
    if (!raw) return [];
    try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
        return [String(parsed)];
    } catch(e) { return [String(raw)]; }
}

// ===== SOUNDS =====
const SOUNDS = {
    hit: new Audio('https://assets.mixkit.co/active_storage/sfx/2788/2788-preview.mp3'),
    enemyHit: new Audio('https://assets.mixkit.co/active_storage/sfx/2790/2790-preview.mp3'),
    potion: new Audio('https://assets.mixkit.co/active_storage/sfx/1487/1487-preview.mp3'),
    victory: new Audio('https://assets.mixkit.co/active_storage/sfx/2019/2019-preview.mp3'),
    swordSwing: new Audio('https://assets.mixkit.co/active_storage/sfx/2786/2786-preview.mp3'),
    alarm: new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3') // 포탈 진입 알람
};
// 사운드 프리로드
Object.values(SOUNDS).forEach(s => { s.preload = 'auto'; s.load(); });

// ===== 진동 + 알람 =====
function triggerPortalAlert() {
    // 진동 패턴: 200ms진동 - 100ms쉼 - 200ms진동 - 100ms쉼 - 300ms진동
    if ('vibrate' in navigator) {
        navigator.vibrate([200, 100, 200, 100, 300]);
    }
    playSound('alarm');
}

let combatState = { playerHP: 100, playerMaxHP: 100, potions: 1, currentEnemy: null, isGameOver: false, isAuto: false };
let autoBattleInterval = null;
let cachedPlayerStats = null;
let cachedMonsterPool = null;
let currentUserId = null; // 로그인된 유저 ID
let currentUserDisplayName = '탐험가'; // 저장된 닉네임

// ===== 파티클 배경 =====
function initParticles() {
    const canvas = document.getElementById('particle-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    const particles = [];
    for (let i = 0; i < 50; i++) {
        particles.push({
            x: Math.random() * canvas.width,
            y: Math.random() * canvas.height,
            size: Math.random() * 2 + 0.5,
            speedY: Math.random() * 0.3 + 0.1,
            alpha: Math.random() * 0.5 + 0.1,
            color: Math.random() > 0.5 ? '0,253,236' : '233,196,0'
        });
    }
    function animate() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        particles.forEach(p => {
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(${p.color},${p.alpha})`;
            ctx.fill();
            p.y -= p.speedY;
            if (p.y < -10) { p.y = canvas.height + 10; p.x = Math.random() * canvas.width; }
        });
        requestAnimationFrame(animate);
    }
    animate();
}

// ===== 비밀번호 해싱 (간단한 SHA-256) =====
async function hashPassword(password) {
    const encoder = new TextEncoder();
    const data = encoder.encode(password + 'jeju_odyssey_salt_2026');
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// ===== 회원가입 =====
async function doRegister() {
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value.trim();
    const msgEl = document.getElementById('login-message');
    if (!username || !password) { msgEl.innerText = '아이디와 비밀번호를 입력하세요.'; msgEl.style.color = 'var(--accent-red)'; return; }
    if (username.length < 2) { msgEl.innerText = '아이디는 2자 이상이어야 합니다.'; msgEl.style.color = 'var(--accent-red)'; return; }
    if (password.length < 4) { msgEl.innerText = '비밀번호는 4자 이상이어야 합니다.'; msgEl.style.color = 'var(--accent-red)'; return; }
    
    msgEl.innerText = '계정 생성 중...'; msgEl.style.color = 'var(--secondary-cyan)';
    const hash = await hashPassword(password);
    
    // 중복 체크
    const { data: existing } = await db.from('users').select('id').eq('username', username).single();
    if (existing) { msgEl.innerText = '이미 사용 중인 아이디입니다.'; msgEl.style.color = 'var(--accent-red)'; return; }
    
    // 닉네임 프롬프트 추가
    const nickname = prompt('게임에서 사용할 닉네임을 입력하세요 (미입력 시 아이디 사용):', username);
    if (nickname === null) {
        msgEl.innerText = '회원가입이 취소되었습니다.'; msgEl.style.color = 'var(--text-dim)'; return;
    }
    const finalNickname = nickname.trim() || username;

    // 유저 생성
    const { data: newUser, error } = await db.from('users').insert({ username, password_hash: hash, display_name: finalNickname }).select().single();
    if (error) { msgEl.innerText = '회원가입 실패: ' + error.message; msgEl.style.color = 'var(--accent-red)'; return; }
    
    // 플레이어 데이터 생성 (빈 인벤토리)
    await db.from('player_state').insert({ id: newUser.id, user_id: newUser.id, hp: 100, atk: 20, def: 10, potions: 1, xp: 0, level: 1, inventory: [], selected_card: -1 });
    
    msgEl.innerText = '✅ 회원가입 완료! 로그인해주세요.'; msgEl.style.color = 'var(--secondary-cyan)';
}

// ===== 로그인 =====
async function doLogin() {
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value.trim();
    const msgEl = document.getElementById('login-message');
    if (!username || !password) { msgEl.innerText = '아이디와 비밀번호를 입력하세요.'; msgEl.style.color = 'var(--accent-red)'; return; }
    
    msgEl.innerText = '로그인 중...'; msgEl.style.color = 'var(--secondary-cyan)';
    const hash = await hashPassword(password);
    
    const { data: user } = await db.from('users').select('*').eq('username', username).eq('password_hash', hash).single();
    if (!user) { msgEl.innerText = '아이디 또는 비밀번호가 올바르지 않습니다.'; msgEl.style.color = 'var(--accent-red)'; return; }
    
    // 로그인 성공
    currentUserId = user.id;
    currentUserDisplayName = user.display_name || user.username || '탐험가';
    window.isAdmin = user.is_admin || false;
    await db.from('users').update({ last_login: new Date().toISOString() }).eq('id', user.id);
    
    // 기억하기 체크 시 localStorage 저장
    const remember = document.getElementById('login-remember')?.checked;
    if (remember) {
        localStorage.setItem('jeju_saved_user', username);
        localStorage.setItem('jeju_saved_pass', password);
        localStorage.setItem('jeju_remember', 'true');
    } else {
        localStorage.removeItem('jeju_saved_user');
        localStorage.removeItem('jeju_saved_pass');
        localStorage.removeItem('jeju_remember');
    }
    
    // 유저 데이터 로드
    await initAppForUser();
}

// ===== 유저별 앱 초기화 =====
async function initAppForUser() {
    try {
        cachedMonsterPool = await getMonsterPool();
        cachedPlayerStats = await getPlayerSettings();
        await getRiftGrades();
        await updateEquippedCardDisplay();
        updateClock();
        updateHuntLogUI();
        
        // 관리자 여부에 따라 설정 버튼 표시/숨김
        const settingsBtn = document.getElementById('btn-settings');
        if (settingsBtn) settingsBtn.style.display = window.isAdmin ? 'block' : 'none';
        
        // 실시간 동기화 시작
        startHeartbeat();
        startSettingsSync();
        
        showScreen('main');
    } catch(e) { console.log("Init warning:", e); showScreen('main'); }
}

// ===== 로그아웃 =====
function doLogout() {
    currentUserId = null;
    window.isAdmin = false;
    cachedPlayerStats = null;
    huntLog = { kills: 0, bossKills: 0, potions: 0, cardsGot: 0 };
    stopHeartbeat();
    showScreen('login');
}

// 기존 initApp은 파티클만 초기화 + 저장된 로그인 정보 복원
function initApp() {
    initParticles();
    updateClock();
    // 저장된 로그인 정보 자동 채우기
    const savedUser = localStorage.getItem('jeju_saved_user');
    const savedPass = localStorage.getItem('jeju_saved_pass');
    const savedRemember = localStorage.getItem('jeju_remember');
    if (savedUser && savedPass && savedRemember === 'true') {
        const uEl = document.getElementById('login-username');
        const pEl = document.getElementById('login-password');
        const rEl = document.getElementById('login-remember');
        if (uEl) uEl.value = savedUser;
        if (pEl) pEl.value = savedPass;
        if (rEl) rEl.checked = true;
    }
}
initApp();

activeScreen = 'login';
let previousScreen = 'main';

function goBack() {
    if (previousScreen && previousScreen !== activeScreen) {
        showScreen(previousScreen);
    } else {
        showScreen('main');
    }
}

function showScreen(screenId) {
    if (activeScreen && activeScreen !== screenId) {
        previousScreen = activeScreen;
    }
    activeScreen = screenId;
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const target = document.getElementById(`screen-${screenId}`);
    if (target) target.classList.add('active');
    
    // 미션 오버레이는 대시보드(지도) 화면에서만 표시
    const mo = document.getElementById('mission-overlay');
    if (mo) {
        if (screenId === 'dashboard') mo.style.display = 'block';
        else mo.style.display = 'none';
    }

    if (screenId === 'dashboard') {
        setTimeout(() => { initMap(); startTracking(); loadPortals(); if (map) { map.invalidateSize(); map.setView(currentUserPos, 17); } }, 100);
    } else if (screenId === 'settings') {
        setTimeout(() => { initSettings(); renderCardEditor(); loadDropSettingsUI(); loadGameConfigUI(); loadAdminUserList(); }, 100);
    } else if (screenId === 'inventory') {
        renderInventory(); renderCraftGrid();
    } else if (screenId === 'collection') {
        renderCollection();
    } else if (screenId === 'main') {
        updateEquippedCardDisplay(); updateMainShards();
    } else { stopTracking(); }
}


function tryStartAdventure() {
    showScreen('dashboard');
}

async function updateMainShards() {
    const shards = await getShards();
    const el = document.getElementById('main-shard-count');
    if(el) el.innerText = shards;
}
async function renderCraftGrid() {
    const templates = await getCardTemplates();
    const config = await getGameConfig();
    const shards = await getShards();
    const cost = config.shardCost || 10;
    const grid = document.getElementById('craft-card-grid');
    if(!grid) return;
    grid.innerHTML = '';
    templates.forEach(t => {
        const canCraft = shards >= cost;
        const div = document.createElement('div');
        div.style.cssText = `text-align:center;padding:10px;background:rgba(0,253,236,0.03);border-radius:10px;border:1px solid ${canCraft?'rgba(0,253,236,0.2)':'rgba(255,255,255,0.06)'};cursor:pointer;`;
        div.innerHTML = `<img src="${t.img}" style="width:40px;height:50px;object-fit:cover;border-radius:6px;margin-bottom:4px;" onerror="this.src='goblin_card.png'">
            <div style="font-size:0.7rem;color:#fff;font-weight:700;">${t.name}</div>
            <div style="font-size:0.55rem;color:var(--secondary-cyan);margin-top:2px;">💎${cost}개</div>`;
        div.onclick = () => craftCard(t.templateId);
        grid.appendChild(div);
    });
}

function initMap() {
    if (map) return;
    map = L.map('map', { zoomControl: false, attributionControl: false }).setView(currentUserPos, 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {attribution:'© OpenStreetMap'}).addTo(map);
    const customIcon = L.divIcon({ className: 'gps-marker-container', html: '<div class="portal-node" style="background: var(--primary-gold); box-shadow: 0 0 20px var(--primary-gold);"></div>', iconSize: [20, 20], iconAnchor: [10, 10] });
    userMarker = L.marker(currentUserPos, { icon: customIcon }).addTo(map);
    accuracyCircle = L.circle(currentUserPos, { radius: 0, color: '#00fdec', weight: 1, fillOpacity: 0.1 }).addTo(map);
}

async function loadPortals() {
    portalMarkers.forEach(m => map.removeLayer(m));
    portalMarkers = [];
    const portals = await getPortals();
    const pool = await getMonsterPool();
    portals.forEach(p => {
        const names = parsePortalMonsters(p.target_monster_name);
        const hasHighTier = names.some(n => { const m = pool.find(x => x.name === n); return m && (m.type === 'rare' || m.type === 'unique'); });
        const hexColor = hasHighTier ? '#ffa500' : '#00fdec';
        const cssColor = hasHighTier ? 'var(--primary-gold)' : 'var(--secondary-cyan)';
        // 반경 원 표시
        const radiusCircle = L.circle([p.lat, p.lng], {
            radius: p.radius || 100,
            color: hexColor,
            weight: 1.5,
            opacity: 0.5,
            fillColor: hexColor,
            fillOpacity: 0.08,
            dashArray: '6, 4'
        }).addTo(map);
        portalMarkers.push(radiusCircle);
        // 포탈 마커
        const icon = L.divIcon({ className: 'portal-marker', html: `<div class="portal-node" style="background:${cssColor};box-shadow:0 0 20px ${cssColor};"></div>`, iconSize: [20, 20], iconAnchor: [10, 10] });
        const marker = L.marker([p.lat, p.lng], { icon: icon }).addTo(map).on('click', () => { forcedPortalId = p.id; checkProximity(); });
        portalMarkers.push(marker);
    });
}

function startTracking() {
    // 백그라운드 유지 시스템 시작
    requestWakeLock();
    startBackgroundKeepAlive();
    
    if ("geolocation" in navigator) {
        watchId = navigator.geolocation.watchPosition((pos) => {
            // ★ GPS 노이즈 필터: 정확도 30m 초과 무시
            if (pos.coords.accuracy > 30) {
                console.log('[GPS] 정확도 낮음, 무시:', Math.round(pos.coords.accuracy), 'm');
                return;
            }
            const newPos = [pos.coords.latitude, pos.coords.longitude];
            const distMoved = L.latLng(lastWalkPos).distanceTo(newPos);
            // ★ 한 번에 30m 이상 점프하면 GPS 오류로 간주
            if (distMoved > 30) {
                console.log('[GPS] 비정상 점프 무시:', Math.round(distMoved), 'm');
                lastWalkPos = newPos;
                currentUserPos = newPos;
                if (userMarker) userMarker.setLatLng(currentUserPos);
                return;
            }
            // 최소 3m 이상 이동 시에만 거리 누적
            if (distMoved > 3 && activeMissionPortalId) { walkAccumulator += distMoved; lastWalkPos = newPos; }
            else if (!activeMissionPortalId) { lastWalkPos = newPos; }
            currentUserPos = newPos;
            if (userMarker) userMarker.setLatLng(currentUserPos);
            if (accuracyCircle) { accuracyCircle.setLatLng(currentUserPos); accuracyCircle.setRadius(pos.coords.accuracy); }
            if (map && activeScreen === 'dashboard') map.panTo(currentUserPos);
            checkProximity();
            updateDashboardHUD();
        }, (err) => console.error("GPS_ERROR:", err), { enableHighAccuracy: true, maximumAge: 2000 });
    }
}

async function updateDashboardHUD() {
    const inv = await getInventory();
    equippedCardIdx = await getEquippedIdx();
    const bcn = document.getElementById('battle-card-name');
    if (bcn) {
        if (equippedCardIdx>=0 && equippedCardIdx<inv.length) {
            bcn.innerText = `${currentUserDisplayName} [${inv[equippedCardIdx].name}]`;
        } else {
            bcn.innerText = currentUserDisplayName;
        }
    }

    const hpText = document.getElementById('hud-hp-text');
    if (hpText && combatState.playerMaxHP > 0) hpText.innerText = `${Math.ceil((combatState.playerHP/combatState.playerMaxHP)*100)}%`;
    const hpBar = document.getElementById('hud-hp-bar');
    if (hpBar && combatState.playerMaxHP > 0) hpBar.style.width = `${(combatState.playerHP/combatState.playerMaxHP)*100}%`;
}

function updateHuntLogUI() {
    const el = document.getElementById('hunt-log-panel');
    if (!el) return;
    const hk = document.getElementById('hunt-kills'); if(hk) hk.innerText = huntLog.kills;
    const hb = document.getElementById('hunt-boss-kills'); if(hb) hb.innerText = huntLog.bossKills;
    const hp = document.getElementById('hunt-potions'); if(hp) hp.innerText = huntLog.potions;
}

// ===== PROXIMITY / ENCOUNTER =====
let proximityRunning = false;
let portalActionMode = null; // 'enter' or 'exit'
let portalActionTarget = null; // 팝업 대상 포탈
let exitConfirmShown = false; // 이탈 팝업 중복 방지

async function checkProximity() {
    if (activeScreen !== 'dashboard') return;
    if (encounterPending || proximityRunning) return;
    proximityRunning = true;
    try {
        // ★ 전투 중이면 포탈 체크 스킵
        if (activeScreen === 'combat') { proximityRunning = false; return; }
        const portals = await getPortals();
        const pool = await getMonsterPool();
        let nearestDist = Infinity;
        let insidePortals = [];
        portals.forEach(p => {
            const dist = L.latLng(currentUserPos).distanceTo(L.latLng(p.lat, p.lng));
            if (dist < nearestDist) nearestDist = dist;
            if (dist < (p.radius || 100)) {
                const names = parsePortalMonsters(p.target_monster_name);
                const hasBoss = names.some(n => { const m = pool.find(x => x.name === n); return m && m.type === 'boss'; });
                insidePortals.push({ portal: p, dist, hasBoss });
            } else {
                if (ignoredPortalIds.has(p.id) && dist > (p.radius || 100) * 1.5) ignoredPortalIds.delete(p.id);
            }
        });
        // 보스 포탈 우선
        insidePortals.sort((a, b) => {
            if (a.hasBoss !== b.hasBoss) return a.hasBoss ? -1 : 1;
            return a.dist - b.dist;
        });
        const insidePortal = insidePortals.length > 0 ? insidePortals[0].portal : null;
        const statusText = document.getElementById('distance-info');
        if (statusText) statusText.innerText = (nearestDist === Infinity) ? "주변 신호: 없음" : `근처 신호: ${Math.round(nearestDist)}m 거리`;
        const missionOverlay = document.getElementById('mission-overlay');
        const confirmModal = document.getElementById('portal-confirm-modal');

        if (insidePortal) {
            currentMissionPortal = insidePortal;
            
            // ★ 진입 확인 팝업 (아직 진입하지 않았고, 무시하지 않았을 때)
            if (activeMissionPortalId !== insidePortal.id && !ignoredPortalIds.has(insidePortal.id) && pendingConfirmationPortalId !== insidePortal.id) {
                pendingConfirmationPortalId = insidePortal.id;
                exitConfirmShown = false;
                const names = parsePortalMonsters(insidePortal.target_monster_name);
                const hasBoss = names.some(n => { const m = pool.find(x => x.name === n); return m && m.type === 'boss'; });
                triggerPortalAlert();
                showPortalModal('enter', insidePortal, hasBoss);
            }
            
            // 미션 진행 중 (진입 확인 후)
            if (activeMissionPortalId === insidePortal.id) {
                missionOverlay.style.display = 'block';
                document.getElementById('mission-title').innerText = insidePortal.name;
                document.getElementById('mission-desc').innerText = insidePortal.mission_text || "이 지역을 조사하십시오.";
                const targetDist = insidePortal.spawn_distance_requirement || 20;
                document.getElementById('mission-walk-dist').innerText = Math.floor(walkAccumulator);
                document.getElementById('mission-target-dist').innerText = targetDist;
                document.getElementById('mission-xp-bar').style.width = `${Math.min(100, (walkAccumulator / targetDist) * 100)}%`;

                if (walkAccumulator >= targetDist) {
                    const chance = insidePortal.spawn_chance ?? 1;
                    const roll = Math.random();
                    console.log('[ENCOUNTER] 거리 충족! 확률 체크:', Math.round(chance*100)+'%', 'roll:', roll.toFixed(2));
                    if (roll < chance) {
                        encounterPending = true;
                        const assignedNames = parsePortalMonsters(insidePortal.target_monster_name);
                        let monsterToSpawn = null;
                        if (assignedNames.length > 0) {
                            monsterToSpawn = assignedNames[Math.floor(Math.random() * assignedNames.length)];
                        } else {
                            // 균열 등급에 따라 자동으로 몬스터 필터링
                            const riftGrade = getPortalRiftGrade(insidePortal.id);
                            const filtered = getMonstersByRiftGrade(pool, riftGrade);
                            if (filtered.length > 0) {
                                monsterToSpawn = filtered[Math.floor(Math.random() * filtered.length)].name;
                            }
                        }
                        triggerPortalAlert();
                        document.getElementById('map-status').innerHTML = `<span style="color: var(--accent-red); animation: pulse 1s infinite; font-weight:bold;">[!] 적의 기습! 자동전투 진입...</span>`;
                        missionOverlay.style.display = 'none';
                        setTimeout(() => { walkAccumulator = 0; encounterPending = false; startCombat(monsterToSpawn, true); }, 1200);
                        proximityRunning = false;
                        return;
                    } else {
                        walkAccumulator = 0;
                        document.getElementById('map-status').innerHTML = `<span style="color: var(--text-dim);">[...] 기척이 사라졌다... 다시 탐색 중 (${Math.round(chance*100)}%)</span>`;
                    }
                }
            }
        } else {
            // 포탈 반경 밖으로 나감
            if (autoHuntPortal && !exitConfirmShown) {
                // ★ 이탈 확인 팝업
                exitConfirmShown = true;
                portalActionTarget = autoHuntPortal;
                showPortalModal('exit', autoHuntPortal, false);
                proximityRunning = false;
                return;
            }
            if (!autoHuntPortal) {
                currentMissionPortal = null;
                pendingConfirmationPortalId = null;
                confirmModal.style.display = 'none';
                missionOverlay.style.display = 'none';
            }
        }
    } finally { proximityRunning = false; }
}

function showPortalModal(mode, portal, isBoss) {
    portalActionMode = mode;
    portalActionTarget = portal;
    const modal = document.getElementById('portal-confirm-modal');
    const icon = document.getElementById('portal-modal-icon');
    const title = document.getElementById('portal-modal-title');
    const desc = document.getElementById('portal-modal-desc');
    const mission = document.getElementById('portal-modal-mission');
    const confirmBtn = document.getElementById('portal-modal-confirm');
    const cancelBtn = document.getElementById('portal-modal-cancel');

    if (mode === 'enter') {
        icon.innerText = isBoss ? '⚔' : '⚡';
        icon.style.color = isBoss ? 'var(--primary-gold)' : 'var(--secondary-cyan)';
        title.innerText = isBoss ? `🔥 보스 포탈: ${portal.name}` : `📍 ${portal.name}`;
        title.style.color = isBoss ? 'var(--primary-gold)' : 'var(--secondary-cyan)';
        desc.innerText = portal.mission_text || '이 지역에 차원 균열이 감지되었습니다.';
        const spawnPct = Math.round((portal.spawn_chance ?? 1) * 100);
        mission.innerText = `이동 ${portal.spawn_distance_requirement||20}m마다 인카운터 (출현율 ${spawnPct}%)`;
        confirmBtn.innerText = isBoss ? '⚔ 보스 도전!' : '⚡ 진입하기';
        confirmBtn.style.background = isBoss ? 'linear-gradient(135deg, #e9c400, #ff6b00)' : '';
        cancelBtn.innerText = '무시하기';
    } else {
        icon.innerText = '🚪';
        icon.style.color = 'var(--accent-red)';
        title.innerText = `${portal.name} 구역 이탈`;
        title.style.color = 'var(--accent-red)';
        desc.innerText = '포탈 범위를 벗어났습니다.';
        mission.innerText = '이탈하면 자동사냥이 종료됩니다.';
        confirmBtn.innerText = '이탈하기';
        confirmBtn.style.background = '';
        cancelBtn.innerText = '돌아가기';
    }
    modal.style.display = 'flex';
}

function confirmPortalAction() {
    const modal = document.getElementById('portal-confirm-modal');
    modal.style.display = 'none';

    if (portalActionMode === 'enter' && portalActionTarget) {
        // 진입 확정
        activeMissionPortalId = portalActionTarget.id;
        autoHuntPortal = portalActionTarget;
        pendingConfirmationPortalId = null;
        walkAccumulator = 0;
        lastWalkPos = currentUserPos;
        exitConfirmShown = false;
        if ('vibrate' in navigator) navigator.vibrate(200);
        const spawnPct = Math.round((portalActionTarget.spawn_chance ?? 1) * 100);
        document.getElementById('map-status').innerHTML = `<span style="color: var(--secondary-cyan); font-weight:bold;">📍 ${portalActionTarget.name} 탐사 중 (출현율 ${spawnPct}%)</span>`;
        checkProximity();
    } else if (portalActionMode === 'exit') {
        // 이탈 확정
        document.getElementById('map-status').innerHTML = `<span style="color: var(--secondary-cyan);">[!] ${autoHuntPortal?.name||'포탈'} 구역 이탈. 탐사 종료.</span>`;
        autoHuntPortal = null;
        activeMissionPortalId = null;
        walkAccumulator = 0;
        currentMissionPortal = null;
        pendingConfirmationPortalId = null;
        exitConfirmShown = false;
        document.getElementById('mission-overlay').style.display = 'none';
    }
    portalActionMode = null;
    portalActionTarget = null;
}

function rejectPortalAction() {
    const modal = document.getElementById('portal-confirm-modal');
    modal.style.display = 'none';

    if (portalActionMode === 'enter' && portalActionTarget) {
        // 무시
        ignoredPortalIds.add(portalActionTarget.id);
        pendingConfirmationPortalId = null;
    } else if (portalActionMode === 'exit') {
        // 돌아가기 (이탈 취소) - 사냥 유지
        exitConfirmShown = false;
    }
    portalActionMode = null;
    portalActionTarget = null;
}

function stopTracking() { if (watchId) navigator.geolocation.clearWatch(watchId); }

// ===== COMBAT — 완전 자동 전투 =====
async function startCombat(forcedMonsterName = null, autoStart = false) {
    const config = await getGameConfig();
    const base = config.playerBaseStats || {hp:100,atk:15,def:5};
    const playerData = await getPlayerSettings();
    // 장착 카드 패시브 적용
    const inv = await getInventory();
    equippedCardIdx = await getEquippedIdx();
    let bonus = {hp:0,atk:0,def:0,crit:0,dodge:0,drain:0};
    let equippedCard = null;
    if (equippedCardIdx>=0 && equippedCardIdx<inv.length) {
        equippedCard = inv[equippedCardIdx];
        bonus = getPassiveBonus(equippedCard);
    }
    const finalHp = Math.floor(base.hp * (1 + bonus.hp / 100));
    const finalAtk = Math.floor(base.atk * (1 + bonus.atk / 100));
    const finalDef = Math.floor(base.def * (1 + bonus.def / 100));
    const pool = await getMonsterPool();
    let targetMonster;
    if (forcedMonsterName) {
        targetMonster = pool.find(m => m.name === forcedMonsterName) || pool[0];
    } else {
        const normals = pool.filter(m => m.type === 'normal' || m.type === 'magic');
        const p = normals.length > 0 ? normals : pool;
        targetMonster = p[Math.floor(Math.random() * p.length)];
    }
    const randBetween = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
    const mHp = randBetween(targetMonster.hpMin || targetMonster.hp || 100, targetMonster.hpMax || targetMonster.hp || 100);
    const mAtk = randBetween(targetMonster.atkMin || targetMonster.dmg || 10, targetMonster.atkMax || targetMonster.dmg || 10);
    const mDef = randBetween(targetMonster.defMin || 0, targetMonster.defMax || 0);
    const mType = targetMonster.type || 'normal';
    const mTypeInfo = MONSTER_TYPES[mType] || MONSTER_TYPES.normal;
    combatState = {
        playerHP: finalHp, playerMaxHP: finalHp,
        playerAtk: finalAtk, playerDef: finalDef,
        crit: bonus.crit, dodge: bonus.dodge, drain: bonus.drain,
        potions: playerData.potions || 0,

        currentEnemy: { ...targetMonster, hp: mHp, maxHp: mHp, dmg: mAtk, def: mDef },
        isGameOver: false, busy: false,
        cardName: currentUserDisplayName, equippedCard
    };
    // UI 업데이트 - 적
    const nameLabel = document.getElementById('enemy-name-label');
    nameLabel.innerText = `${mTypeInfo.icon} ${targetMonster.name} [${mTypeInfo.name}]`;
    nameLabel.style.color = mTypeInfo.color;
    document.getElementById('enemy-img-main').src = targetMonster.img;
    document.getElementById('enemy-img-main').style.opacity = '1';
    // UI - 플레이어
    const pn = document.getElementById('player-card-name'); if(pn) pn.innerText = currentUserDisplayName;
    const pr = document.getElementById('player-card-rarity');
    if(pr) {
        if(equippedCard) { pr.innerText = `[${equippedCard.name}]`; pr.style.color = rarityColor(equippedCard.rarity); }

        else { pr.innerText = '[장비 없음]'; pr.style.color = 'var(--text-dim)'; }
    }
    updateCombatUI();
    document.getElementById('combat-log').innerHTML = `<div class="log-entry">${currentUserDisplayName} vs ${mTypeInfo.icon} ${targetMonster.name} 전투 개시!</div>`;
    playSound('swordSwing'); showScreen('combat');
    // 1인칭 시점: 적 등장 애니메이션
    const enemyImg = document.getElementById('enemy-img-main');
    if (enemyImg) {
        enemyImg.style.transform = 'scale(0.3) translateY(100px)';
        enemyImg.style.opacity = '0';
        setTimeout(() => { enemyImg.style.transition = 'all 0.8s cubic-bezier(0.175,0.885,0.32,1.275)'; enemyImg.style.transform = 'scale(1)'; enemyImg.style.opacity = '1'; }, 100);
    }
    // 비네팅 플래시 효과
    const vignette = document.getElementById('fps-vignette');
    if (vignette) {
        vignette.style.background = 'radial-gradient(ellipse at center,transparent 30%,rgba(255,0,0,0.3) 100%)';
        setTimeout(() => { vignette.style.background = 'radial-gradient(ellipse at center,transparent 50%,rgba(0,0,0,0.6) 100%)'; }, 600);
    }
    setTimeout(() => startAutoCombat(), 800);
}
function startAutoCombat() {
    if (autoBattleInterval) clearInterval(autoBattleInterval);
    autoBattleInterval = setInterval(() => {
        if (!combatState.isGameOver && !combatState.busy) executePlayerTurn();
        else if (combatState.isGameOver) { clearInterval(autoBattleInterval); autoBattleInterval=null; }
    }, 1200);
    // ★ 안전장치: busy가 3초 이상 지속되면 강제 해제
    setInterval(() => {
        if (combatState.busy && !combatState.isGameOver) {
            combatState.busy = false;
            console.log('[COMBAT] busy 강제 해제');
        }
    }, 3000);
}

async function usePotion() {
    if (combatState.isGameOver || combatState.busy || combatState.potions <= 0) return;
    combatState.busy = true;
    try {
        const heal = Math.floor(combatState.playerMaxHP * 0.5);
        combatState.playerHP = Math.min(combatState.playerMaxHP, combatState.playerHP + heal);
        combatState.potions--;
        await db.from('player_state').update({ potions: combatState.potions }).eq('id', currentUserId||'singleton');
        playSound('potion'); renderLog(`포션! HP +${heal}`, 'player'); updateCombatUI();
    } catch(e) { console.error('[POTION] error:', e); }
    setTimeout(() => { combatState.busy = false; }, 800);
}
function updateActionButtons(enabled) {
    const p = document.getElementById('btn-potion');
    if (p) p.disabled = !enabled || combatState.potions <= 0;
}
function playSound(name) { if (SOUNDS[name]) { SOUNDS[name].currentTime = 0; SOUNDS[name].play().catch(() => {}); } }
function triggerShake() {
    // 1인칭: 화면 전체 흔들림 + 비네팅 빨갛게
    const s = document.querySelector('.combat-scene');
    if(s) { s.classList.add('shake'); setTimeout(() => s.classList.remove('shake'), 400); }
    const v = document.getElementById('fps-vignette');
    if(v) { v.style.background='radial-gradient(ellipse at center,transparent 30%,rgba(255,0,0,0.4) 100%)'; setTimeout(()=>{ v.style.background='radial-gradient(ellipse at center,transparent 50%,rgba(0,0,0,0.6) 100%)'; },400); }
}

function executeEnemyTurn() {
    if (combatState.isGameOver) return;
    combatState.busy = true;
    const enemy = combatState.currentEnemy;
    let raw = Math.floor(Math.random() * 5) + enemy.dmg;
    // 회피 체크 (패시브 dodge)
    const dodgeChance = combatState.dodge || 0;
    if (dodgeChance > 0 && Math.random()*100 < dodgeChance) {
        renderLog(`💨 ${currentUserDisplayName} 회피!`, 'player');

        setTimeout(() => { combatState.busy = false; }, 500);
        updateCombatUI(); return;
    }
    let dmg = Math.max(1, raw - Math.floor(raw * (combatState.playerDef / 100)));
    combatState.playerHP = Math.max(0, combatState.playerHP - dmg);
    triggerShake(); playSound('enemyHit');
    const scene = document.querySelector('.combat-scene');
    if(scene) { scene.classList.add('flash-red','glitch'); setTimeout(() => scene.classList.remove('flash-red','glitch'), 300); }
    renderLog(`${enemy.name} 공격! ${dmg} 대미지`, 'enemy');
    if (combatState.playerHP <= 0) {
        renderLog('카드 파괴! 후퇴.', 'enemy');
        combatState.isGameOver = true;
        if (autoBattleInterval) { clearInterval(autoBattleInterval); autoBattleInterval=null; }
        if ('vibrate' in navigator) navigator.vibrate([500, 200, 500]);
        setTimeout(() => { showScreen('dashboard'); }, 2000);
    } else {
        // 자동 포션 (HP 30% 이하)
        if (combatState.potions > 0 && (combatState.playerHP/combatState.playerMaxHP) < 0.3) {
            setTimeout(() => { usePotion(); }, 500);
        } else {
            setTimeout(() => { combatState.busy = false; }, 500);
        }
    }
    updateCombatUI();
}

function stopAutoBattle() {
    if (autoBattleInterval) clearInterval(autoBattleInterval); autoBattleInterval = null;
}

function executePlayerTurn() {
    if (combatState.isGameOver || combatState.busy) return;
    combatState.busy = true;
    let enemy = combatState.currentEnemy;
    let dmg = Math.floor(Math.random() * 10) + combatState.playerAtk;
    let healAmt = 0;
    // 크리티컬 체크 (패시브)
    const critChance = combatState.crit || 0;
    if (critChance > 0 && Math.random()*100 < critChance) {
        dmg = dmg * 2;
        renderLog('💥 크리티컬! 2배 데미지!', 'player');
    }
    // 방어 적용
    const enemyDef = enemy.def || 0;
    dmg = Math.max(1, dmg - Math.floor(dmg * (enemyDef / 100)));
    enemy.hp = Math.max(0, enemy.hp - dmg);
    // 흡혈 체크 (패시브)
    const drainRate = combatState.drain || 0;
    if (drainRate > 0 && dmg > 0) {
        healAmt = Math.floor(dmg * drainRate / 100);
        combatState.playerHP = Math.min(combatState.playerMaxHP, combatState.playerHP + healAmt);
    }
    playSound('swordSwing'); setTimeout(() => playSound('hit'), 150);
    const img = document.getElementById('enemy-img-main');
    if(img) { img.classList.add('shake'); setTimeout(() => img.classList.remove('shake'), 400); }
    renderLog(`${currentUserDisplayName} 공격! ${dmg} 대미지${healAmt?` (+${healAmt} 흡혈)`:''}`, 'player');
    updateCombatUI();
    if (enemy.hp <= 0) {
        combatState.busy = false;
        handleVictory();
    } else {
        setTimeout(() => { combatState.busy = false; executeEnemyTurn(); }, 1000);
    }
}

async function handleVictory() {
    playSound('victory'); renderLog('전투 승리!', 'player');
    combatState.isGameOver = true;
    combatState.busy = false;
    stopAutoBattle();
    const eImg = document.getElementById('enemy-img-main');
    if(eImg) eImg.style.opacity = '0';
    if ('vibrate' in navigator) navigator.vibrate([100, 50, 100, 50, 200]);
    
    huntLog.kills++;
    const mType = combatState.currentEnemy.type || 'normal';
    if (mType === 'rare' || mType === 'unique') huntLog.bossKills++;
    
    try {
        const config = await getGameConfig();
        const drops = config.monsterDrops || DEFAULT_GAME_CONFIG.monsterDrops;
        const tierDrop = drops[mType] || drops.normal;
        let stats = await getPlayerSettings();
        
        // 카드 직접 드랍
        let cardDropped = false;
        
        try {
            const mPool = await getMonsterPool();
            const monster = mPool.find(m => m.name === combatState.currentEnemy.name);
            if (monster && monster.dropCardTemplateId && monster.dropCardRate > 0) {
                if (Math.random() * 100 < monster.dropCardRate) {
                    if (typeof getCardTemplates === 'function' && typeof generateCard === 'function' && typeof saveInventory === 'function' && typeof getInventory === 'function') {
                        const templates = await getCardTemplates();
                        const t = templates.find(x => x.templateId === monster.dropCardTemplateId);
                        if (t) {
                            const inv = await getInventory();
                            if (inv.length < 10) { // 인벤토리 제한 확인
                                const card = await generateCard(t);
                                inv.push(card);
                                await saveInventory(inv);
                                cardDropped = true;
                                huntLog.cardsGot++;
                                renderLog(`🎴 [${t.name}] 카드 획득!`, 'player');
                                if (typeof showCardDropPopup === 'function') {
                                    showCardDropPopup(card);
                                }
                            } else {
                                renderLog(`인벤토리가 가득 차서 카드를 획득하지 못했습니다.`, 'enemy');
                            }
                        }
                    }
                }
            }
        } catch(e) { console.error('카드 드랍 오류:', e); }

        if (!cardDropped) {
            renderLog('드랍 없음', 'enemy');
        }
        
        // 포션 드랍
        if (Math.random() * 100 < (tierDrop.potionRate || 20)) {
            stats.potions = (stats.potions||0) + 1;
            huntLog.potions++;
            renderLog('💊 포션 드랍!', 'player');
        }
        await db.from('player_state').update({
            hp: stats.hp,
            atk: stats.atk,
            def: stats.def,
            xp: stats.xp,
            level: stats.level,
            potions: stats.potions
        }).eq('id', currentUserId||'singleton');
    } catch(e) {
        console.error('[VICTORY] DB error:', e);
        renderLog('데이터 저장 오류 (자동 복구)', 'enemy');
    }
    updateDashboardHUD();
    updateHuntLogUI();
    
    stopAutoBattle();
    
    setTimeout(async () => { 
        if (!combatState.isGameOver) return;
        showScreen('dashboard');
        
        // ★ 아직 포탈 반경 안에 있으면 자동으로 다시 사냥 시작
        if (autoHuntPortal) {
            try {
                const dist = L.latLng(currentUserPos).distanceTo(L.latLng(autoHuntPortal.lat, autoHuntPortal.lng));
                if (dist < (autoHuntPortal.radius || 100)) {
                    activeMissionPortalId = autoHuntPortal.id;
                    walkAccumulator = 0;
                    lastWalkPos = currentUserPos;
                    document.getElementById('map-status').innerHTML = `<span style="color: var(--secondary-cyan); font-weight:bold;">🔄 ${autoHuntPortal.name} 재탐사 중...</span>`;
                } else {
                    document.getElementById('map-status').innerHTML = `<span style="color: var(--text-dim);">[!] 구역 이탈. 자동사냥 종료.</span>`;
                    autoHuntPortal = null;
                    activeMissionPortalId = null;
                }
            } catch(e) { console.error('[POST_COMBAT] error:', e); }
        }
    }, 2000);
}

function updateCombatUI() {
    const e = combatState.currentEnemy; if (!e) return;
    const ePct = Math.max(0,e.hp/e.maxHp*100);
    const eb = document.getElementById('enemy-hp-bar'); if (eb) eb.style.width = ePct+'%';
    const eht = document.getElementById('enemy-hp-text'); if (eht) eht.innerText = `${e.hp}/${e.maxHp} (${Math.round(ePct)}%)`;
    const pPct = Math.max(0,combatState.playerHP/combatState.playerMaxHP*100);
    const pb = document.getElementById('player-hp-bar'); if (pb) pb.style.width = pPct+'%';
    const pht = document.getElementById('player-hp-text'); if (pht) pht.innerText = `${combatState.playerHP}/${combatState.playerMaxHP} (${Math.round(pPct)}%)`;
    const pot = document.getElementById('btn-potion'); if (pot) { pot.innerText = `💊 HEAL (${combatState.potions})`; pot.disabled = combatState.potions <= 0; }
    const atk = document.getElementById('player-atk-text'); if(atk) atk.innerText = combatState.playerAtk;
    const def = document.getElementById('player-def-text'); if(def) def.innerText = combatState.playerDef;
}
function renderLog(msg, type) { const log = document.getElementById('combat-log'); if(!log) return; const e = document.createElement('div'); e.className = `log-entry ${type}`; e.innerText = msg; log.prepend(e); }
function updateClock() { const t = document.getElementById('system-time'); if (t) { const n = new Date(); t.innerText = n.toTimeString().split(' ')[0] + " // " + n.toLocaleDateString('ko-KR'); } }
setInterval(updateClock, 1000); updateClock();
window.addEventListener('resize', () => { if (map) map.invalidateSize(); if (setMap) setMap.invalidateSize(); });

// ===== SETTINGS =====
let setMap;
async function initSettings() {
    renderSettingsMonsterList();
    initSettingsMap();
    renderSettingsPortalList();
}

async function renderSettingsMonsterList() {
    const pool = await getMonsterPool();
    const container = document.getElementById('set-monster-list');
    container.innerHTML = '';
    
    let templates = [];
    try {
        if (typeof getCardTemplates === 'function') templates = await getCardTemplates();
    } catch(e) {}
    const cardOpts = '<option value="">선택 안함</option>' + templates.map(t => `<option value="${t.templateId}">${t.name}</option>`).join('');

    pool.forEach((m, i) => {
        const typeInfo = MONSTER_TYPES[m.type] || MONSTER_TYPES.normal;
        const item = document.createElement('div');
        item.className = 'glass-panel monster-card';
        item.style.cssText = `margin-bottom:15px; padding:20px; border-left:4px solid ${typeInfo.color};`;
        item.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
                <div style="display:flex; align-items:center; gap:8px;">
                    <span style="font-size:0.75rem; padding:3px 10px; border-radius:16px; font-weight:700;
                        background:rgba(0,0,0,0.3); color:${typeInfo.color}; border:1px solid ${typeInfo.border};">
                        ${typeInfo.icon} ${typeInfo.name}
                    </span>
                    <span style="font-size:0.65rem; color:var(--text-dim);">#${i+1}</span>
                </div>
                <button class="btn-nav" style="padding:5px 12px; font-size:0.65rem; color:var(--accent-red); border-color:var(--accent-red);" onclick="deleteMonster(${i})">삭제</button>
            </div>
            <div style="display:flex; gap:10px; align-items:flex-start;">
                <div style="flex-shrink:0; text-align:center;">
                    <img src="${m.img}" style="width:60px; height:60px; object-fit:contain; border-radius:10px; background:rgba(0,0,0,0.4); border:1px solid var(--glass-border);"
                        onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 80 80%22><text x=%2240%22 y=%2250%22 text-anchor=%22middle%22 font-size=%2240%22>👾</text></svg>'">
                    <label class="btn-nav" style="display:block; margin-top:6px; padding:4px 6px; font-size:0.55rem; cursor:pointer; text-align:center; border-color:var(--secondary-cyan); color:var(--secondary-cyan);">
                        📷 변경
                        <input type="file" accept="image/*" style="display:none;" onchange="uploadMonsterImage(${i}, this)">
                    </label>
                </div>
                <div style="flex:1;min-width:0;">
                    <div style="margin-bottom:8px;">
                        <label>몬스터 이름</label>
                        <input type="text" class="set-m-name btn-nav" data-index="${i}" value="${m.name}" style="width:100%;">
                    </div>
                    <div style="font-size:0.7rem; color:${typeInfo.color}; margin-bottom:4px; font-weight:700;">📊 능력치</div>
                    <div style="display:grid; grid-template-columns:1fr 1fr; gap:6px; margin-bottom:6px;">
                        <div><label style="font-size:0.55rem !important;">HP min</label><input type="number" class="set-m-hpmin btn-nav" data-index="${i}" value="${m.hpMin||m.hp||100}" style="width:100%;"></div>
                        <div><label style="font-size:0.55rem !important;">HP max</label><input type="number" class="set-m-hpmax btn-nav" data-index="${i}" value="${m.hpMax||m.hp||100}" style="width:100%;"></div>
                    </div>
                    <div style="display:grid; grid-template-columns:1fr 1fr; gap:6px; margin-bottom:6px;">
                        <div><label style="font-size:0.55rem !important;">ATK min</label><input type="number" class="set-m-atkmin btn-nav" data-index="${i}" value="${m.atkMin||m.dmg||10}" style="width:100%;"></div>
                        <div><label style="font-size:0.55rem !important;">ATK max</label><input type="number" class="set-m-atkmax btn-nav" data-index="${i}" value="${m.atkMax||m.dmg||10}" style="width:100%;"></div>
                    </div>
                    <div style="display:grid; grid-template-columns:1fr 1fr; gap:6px; margin-bottom:10px;">
                        <div><label style="font-size:0.55rem !important;">DEF min</label><input type="number" class="set-m-defmin btn-nav" data-index="${i}" value="${m.defMin||0}" style="width:100%;"></div>
                        <div><label style="font-size:0.55rem !important;">DEF max</label><input type="number" class="set-m-defmax btn-nav" data-index="${i}" value="${m.defMax||0}" style="width:100%;"></div>
                    </div>
                    <div style="padding:10px; background:rgba(0,0,0,0.3); border-radius:8px; border:1px solid rgba(255,255,255,0.1);">
                        <div style="font-size:0.6rem; color:var(--primary-gold); font-weight:700; margin-bottom:4px;">🎴 카드 드랍 설정</div>
                        <div style="display:flex; align-items:center; gap:8px;">
                            <select class="set-m-card-drop btn-nav" data-index="${i}" style="flex:1; padding:6px; font-size:0.6rem;">${cardOpts}</select>
                            <input type="number" class="set-m-card-rate btn-nav" data-index="${i}" value="${m.dropCardRate||10}" style="width:60px; text-align:center; padding:6px; font-size:0.6rem;" placeholder="확률%">
                        </div>
                    </div>
                </div>
            </div>
        `;
        // set selected option after innerHTML
        setTimeout(() => {
            const select = item.querySelector('.set-m-card-drop');
            if (select) select.value = m.dropCardTemplateId || "";
        }, 0);
        container.appendChild(item);
    });
}

async function uploadMonsterImage(index, input) {
    const file = input.files[0]; if (!file) return;
    const card = input.closest('.monster-card');
    const img = card.querySelector('img'); img.style.opacity = '0.3';
    try {
        // 300KB 이하로 자동 리사이즈
        const dataUrl = await resizeImageFile(file, 300000);

        // base64 → Blob 변환
        const res = await fetch(dataUrl);
        const blob = await res.blob();
        const fileName = `monster_${index}_${Date.now()}.webp`;
        const { error } = await db.storage.from('monster-images').upload(fileName, blob, { contentType: blob.type, cacheControl: '3600', upsert: true });
        if (error) { alert('업로드 실패: ' + error.message); img.style.opacity = '1'; return; }
        const { data: urlData } = db.storage.from('monster-images').getPublicUrl(fileName);
        const pool = await getMonsterPool();
        pool[index].img = urlData.publicUrl;
        await db.from('game_settings').update({ value: pool }).eq('name', 'monsterPool');
        img.src = urlData.publicUrl; img.style.opacity = '1';
        alert(`✅ 이미지 업로드 완료! (${(blob.size/1024).toFixed(0)}KB)`);
    } catch(e) { alert('에러: ' + e.message); img.style.opacity = '1'; }
}

async function addMonster(type) {
    const pool = await getMonsterPool();
    const typeInfo = MONSTER_TYPES[type] || MONSTER_TYPES.normal;
    const defaults = {
        normal: {hpMin:80,hpMax:120,atkMin:8,atkMax:14,defMin:0,defMax:3},
        magic: {hpMin:100,hpMax:160,atkMin:12,atkMax:20,defMin:2,defMax:6},
        rare: {hpMin:150,hpMax:250,atkMin:18,atkMax:30,defMin:5,defMax:12},
        unique: {hpMin:250,hpMax:400,atkMin:25,atkMax:45,defMin:8,defMax:20}
    };
    const d = defaults[type] || defaults.normal;
    pool.push({
        name: `새 ${typeInfo.name} 몬스터`,
        ...d, img: '', type
    });
    await db.from('game_settings').update({ value: pool }).eq('name', 'monsterPool');
    renderSettingsMonsterList();
    if(typeof renderCardEditor === 'function') renderCardEditor();
}
async function deleteMonster(i) {
    if (!confirm('삭제하시겠습니까?')) return;
    const pool = await getMonsterPool(); pool.splice(i, 1);
    await db.from('game_settings').update({ value: pool }).eq('name', 'monsterPool');
    renderSettingsMonsterList();
    if(typeof renderCardEditor === 'function') renderCardEditor();
}
async function saveMonsterPool() {
    const names = document.querySelectorAll('.set-m-name');
    const pool = await getMonsterPool();
    names.forEach((input, i) => {
        pool[i].name = input.value;
        pool[i].hpMin = parseInt(document.querySelectorAll('.set-m-hpmin')[i]?.value)||0;
        pool[i].hpMax = parseInt(document.querySelectorAll('.set-m-hpmax')[i]?.value)||0;
        pool[i].atkMin = parseInt(document.querySelectorAll('.set-m-atkmin')[i]?.value)||0;
        pool[i].atkMax = parseInt(document.querySelectorAll('.set-m-atkmax')[i]?.value)||0;
        pool[i].defMin = parseInt(document.querySelectorAll('.set-m-defmin')[i]?.value)||0;
        pool[i].defMax = parseInt(document.querySelectorAll('.set-m-defmax')[i]?.value)||0;
        // hp, dmg 호환: 전투에서 랜덤 생성 시 사용
        pool[i].hp = pool[i].hpMax;
        pool[i].dmg = pool[i].atkMax;
        
        // 카드 드랍 설정
        pool[i].dropCardTemplateId = document.querySelectorAll('.set-m-card-drop')[i]?.value || "";
        pool[i].dropCardRate = parseFloat(document.querySelectorAll('.set-m-card-rate')[i]?.value) || 0;
    });
    await db.from('game_settings').update({ value: pool }).eq('name', 'monsterPool');
    cachedMonsterPool = pool;
    alert("몬스터 데이터 저장 완료!"); 
    renderSettingsMonsterList();
    if(typeof renderCardEditor === 'function') renderCardEditor();
}

function initSettingsMap() {
    if (setMap) return;
    setMap = L.map('set-map', { zoomControl: true }).setView(currentUserPos, 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {attribution:'© OpenStreetMap'}).addTo(setMap);
    setMap.on('click', async (e) => {
        const name = prompt("지역 이름:", `탐사구역_${Math.floor(Math.random()*1000)}`);
        if (name) {
            await db.from('portals').insert({ id: Date.now(), name, lat: e.latlng.lat, lng: e.latlng.lng, mission_text: "이 지역의 위협 요소를 제거하십시오.", radius: 100, spawn_chance: 0.5, spawn_distance_requirement: 20 });
            renderSettingsPortalList();
        }
    });
}

const RIFT_GRADE_ORDER = ['normal','magic','rare','unique'];
const RIFT_GRADE_INFO = {
    normal: {name:'일반',color:'#ffffff',icon:'🗡',border:'rgba(255,255,255,0.3)'},
    magic: {name:'매직',color:'#4488ff',icon:'✨',border:'rgba(68,136,255,0.4)'},
    rare: {name:'레어',color:'#ffdd00',icon:'⚔',border:'rgba(255,221,0,0.4)'},
    unique: {name:'유니크',color:'#ffa500',icon:'👑',border:'rgba(255,165,0,0.5)'}
};

function getMonstersByRiftGrade(pool, riftGrade) {
    const gradeIdx = RIFT_GRADE_ORDER.indexOf(riftGrade || 'normal');
    const allowedTypes = RIFT_GRADE_ORDER.slice(0, gradeIdx + 1);
    return pool.filter(m => allowedTypes.includes(m.type || 'normal'));
}

// 균열 등급 저장/로드 (game_settings 테이블 사용)
let cachedRiftGrades = {};
async function getRiftGrades() {
    const { data } = await db.from('game_settings').select('value').eq('name', 'portalRiftGrades').single();
    cachedRiftGrades = data ? data.value : {};
    return cachedRiftGrades;
}
async function saveRiftGrade(portalId, grade) {
    cachedRiftGrades[String(portalId)] = grade;
    await db.from('game_settings').upsert({ name: 'portalRiftGrades', value: cachedRiftGrades });
}
function getPortalRiftGrade(portalId) {
    return cachedRiftGrades[String(portalId)] || 'normal';
}

async function renderSettingsPortalList() {
    const portals = await getPortals();
    const pool = await getMonsterPool();
    await getRiftGrades();
    const container = document.getElementById('set-portal-list');
    container.innerHTML = '';
    setMap.eachLayer((layer) => { if (layer instanceof L.Marker || layer instanceof L.Circle) setMap.removeLayer(layer); });
    portals.forEach(p => {
        const riftGrade = getPortalRiftGrade(p.id);
        const gradeInfo = RIFT_GRADE_INFO[riftGrade] || RIFT_GRADE_INFO.normal;
        const assignedNames = parsePortalMonsters(p.target_monster_name);
        const item = document.createElement('div');
        item.className = 'glass-panel';
        item.style.cssText = `margin-bottom:12px; padding:14px 16px; border-left:4px solid ${gradeInfo.color};`;
        let monsterTags = '';
        const filteredMonsters = getMonstersByRiftGrade(pool, riftGrade);
        if (assignedNames.length > 0) {
            monsterTags = assignedNames.map(n => {
                const m = pool.find(x => x.name === n);
                const mType = MONSTER_TYPES[(m?.type)||'normal'];
                return `<span style="font-size:0.5rem; padding:2px 8px; border-radius:10px; background:rgba(${mType.color==='#ffffff'?'255,255,255':mType.color==='#4488ff'?'68,136,255':mType.color==='#ffdd00'?'255,221,0':'255,165,0'},0.1); color:${mType.color}; border:1px solid ${mType.border}; margin-right:4px;">${mType.icon} ${n}</span>`;
            }).join('');
        } else {
            monsterTags = `<span style="font-size:0.5rem; color:var(--text-dim);">등급 자동: ${filteredMonsters.length}종</span>`;
        }
        const gradeBadge = `<span style="font-size:0.55rem; padding:2px 10px; border-radius:10px; background:rgba(0,0,0,0.3); color:${gradeInfo.color}; border:1px solid ${gradeInfo.border}; font-weight:700;">${gradeInfo.icon} ${gradeInfo.name}</span>`;
        item.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:flex-start;">
                <div style="flex:1;">
                    <div style="display:flex; align-items:center; gap:8px; margin-bottom:4px;">
                        <span style="font-size:0.8rem; color:${gradeInfo.color}; font-weight:700;">${p.name}</span>
                        ${gradeBadge}
                    </div>
                    <div style="font-size:0.55rem; color:var(--text-dim); margin-bottom:6px;">${p.mission_text?.substring(0,30) || ''}...</div>
                    <div style="display:flex; flex-wrap:wrap; gap:4px; align-items:center; margin-bottom:4px;">${monsterTags}</div>
                    <div style="font-size:0.5rem; color:var(--text-dim);">반경 ${p.radius || 100}m | 조사 ${p.spawn_distance_requirement || 20}m | 출현율 ${Math.round((p.spawn_chance ?? 1) * 100)}%</div>
                </div>
                <div style="display:flex; gap:8px; flex-shrink:0; padding-top:5px;">
                    <button class="btn-nav" style="padding:5px 12px; font-size:0.6rem; border-color:var(--secondary-cyan);" onclick="openPortalEditor(${p.id})">EDIT</button>
                    <button class="btn-nav" style="padding:5px 12px; font-size:0.6rem; color:var(--accent-red); border-color:var(--accent-red);" onclick="deletePortalInSettings(${p.id})">DEL</button>
                </div>
            </div>`;
        container.appendChild(item);
        const mc = gradeInfo.color === '#ffffff' ? '#00fdec' : gradeInfo.color;
        L.circle([p.lat, p.lng], {
            radius: p.radius || 100,
            color: mc,
            weight: 1.5,
            opacity: 0.6,
            fillColor: mc,
            fillOpacity: 0.1,
            dashArray: '6, 4'
        }).addTo(setMap);
        const mi = L.divIcon({ className: 'portal-marker', html: `<div style="width:14px;height:14px;background:${mc};border-radius:50%;box-shadow:0 0 10px ${mc};border:2px solid rgba(255,255,255,0.3);"></div>`, iconSize: [14,14], iconAnchor: [7,7] });
        L.marker([p.lat, p.lng], { icon: mi }).addTo(setMap).bindPopup(`<b>${p.name}</b><br>${gradeInfo.icon} ${gradeInfo.name} 균열<br>반경: ${p.radius || 100}m`);
    });
}

let editingPortalId = null;
async function openPortalEditor(id) {
    editingPortalId = id;
    const portals = await getPortals();
    const p = portals.find(x => x.id == id);
    const pool = await getMonsterPool();
    const assignedNames = parsePortalMonsters(p.target_monster_name);
    await getRiftGrades();
    const riftGrade = getPortalRiftGrade(p.id);
    document.getElementById('ed-p-name').value = p.name;
    document.getElementById('ed-p-mission').value = p.mission_text || "";
    document.getElementById('ed-p-radius').value = p.radius || 100;
    document.getElementById('ed-p-walk').value = p.spawn_distance_requirement || 20;
    document.getElementById('ed-p-chance').value = Math.round((p.spawn_chance ?? 1) * 100);
    
    // 균열 등급 라디오 버튼 설정
    const gradeRadios = document.querySelectorAll('input[name="rift-grade"]');
    gradeRadios.forEach(r => {
        r.checked = r.value === riftGrade;
        const label = r.closest('.rift-grade-option');
        if (label) {
            label.style.opacity = r.checked ? '1' : '0.5';
            label.style.transform = r.checked ? 'scale(1.05)' : 'scale(1)';
        }
    });
    // 라디오 클릭 시 시각 업데이트
    gradeRadios.forEach(r => {
        r.onchange = () => {
            gradeRadios.forEach(rr => {
                const l = rr.closest('.rift-grade-option');
                if(l) { l.style.opacity = rr.checked?'1':'0.5'; l.style.transform = rr.checked?'scale(1.05)':'scale(1)'; }
            });
            // 등급 변경 시 몬스터 목록 다시 렌더링
            renderPortalMonsterList(pool, assignedNames, r.value);
        };
    });
    
    renderPortalMonsterList(pool, assignedNames, riftGrade);
    document.getElementById('portal-editor-modal').style.display = 'block';
}

function renderPortalMonsterList(pool, assignedNames, riftGrade) {
    const normalContainer = document.getElementById('ed-normal-monsters');
    normalContainer.innerHTML = '';
    // 등급에 따라 출현 가능한 몬스터 필터링
    const filteredMonsters = getMonstersByRiftGrade(pool, riftGrade);
    if (filteredMonsters.length === 0) {
        normalContainer.innerHTML = '<div style="font-size:0.6rem; color:var(--text-dim);">해당 등급의 몬스터 없음</div>';
        return;
    }
    filteredMonsters.forEach(m => {
        const checked = assignedNames.includes(m.name) ? 'checked' : '';
        const typeInfo = MONSTER_TYPES[m.type||'normal'] || MONSTER_TYPES.normal;
        normalContainer.innerHTML += `<label style="display:flex; align-items:center; gap:10px; padding:10px 12px; background:rgba(${typeInfo.color==='#ffffff'?'255,255,255':typeInfo.color==='#4488ff'?'68,136,255':typeInfo.color==='#ffdd00'?'255,221,0':'255,165,0'},0.03); border:1px solid ${typeInfo.border}; border-radius:10px; cursor:pointer; margin-bottom:6px;">
            <input type="checkbox" class="ed-monster-check" value="${m.name}" data-type="${m.type||'normal'}" ${checked} style="width:18px; height:18px; accent-color:${typeInfo.color};">
            <img src="${m.img}" style="width:32px; height:32px; object-fit:contain; border-radius:6px; background:rgba(0,0,0,0.3);" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 32 32%22><text x=%2216%22 y=%2222%22 text-anchor=%22middle%22 font-size=%2218%22>👾</text></svg>'">
            <div><div style="font-size:0.75rem; color:${typeInfo.color}; font-weight:700;">${typeInfo.icon} ${m.name}</div><div style="font-size:0.5rem; color:var(--text-dim);">HP:${m.hpMax||m.hp||100} ATK:${m.atkMax||m.dmg||10} [${typeInfo.name}]</div></div></label>`;
    });
}
function closePortalEditor() { document.getElementById('portal-editor-modal').style.display = 'none'; }
async function applyPortalEdit() {
    const checks = document.querySelectorAll('.ed-monster-check:checked');
    const selectedNames = Array.from(checks).map(c => c.value);
    const chancePct = parseInt(document.getElementById('ed-p-chance').value) || 50;
    const selectedGrade = document.querySelector('input[name="rift-grade"]:checked')?.value || 'normal';
    const data = {
        name: document.getElementById('ed-p-name').value,
        mission_text: document.getElementById('ed-p-mission').value,
        radius: parseInt(document.getElementById('ed-p-radius').value),
        spawn_distance_requirement: parseInt(document.getElementById('ed-p-walk').value),
        spawn_chance: Math.min(100, Math.max(1, chancePct)) / 100,
        target_monster_name: selectedNames.length > 0 ? JSON.stringify(selectedNames) : null
    };
    await db.from('portals').update(data).eq('id', editingPortalId);
    await saveRiftGrade(editingPortalId, selectedGrade);
    closePortalEditor(); renderSettingsPortalList();
}
async function deletePortalInSettings(id) {
    if (confirm("삭제?")) { await db.from('portals').delete().eq('id', id); renderSettingsPortalList(); }
}
async function savePlayerSettings() {
    const stats = { hp: parseInt(document.getElementById('set-p-hp').value), atk: parseInt(document.getElementById('set-p-atk').value), def: parseInt(document.getElementById('set-p-def').value), potions: parseInt(document.getElementById('set-p-pot').value) };
    await db.from('player_state').update(stats).eq('id', currentUserId||'singleton');
    alert("커맨더 데이터 동기화 완료.");
}
async function saveLootSettings() {
    const s = { chance: parseFloat(document.getElementById('set-l-chance').value), fixed: document.getElementById('set-l-fixed').checked };
    await db.from('game_settings').update({ value: s }).eq('name', 'lootSettings');
    alert("아이템 드랍 설정 저장 완료.");
}

// ===== 실시간 Heart Beat & 설정 동기화 =====
let heartbeatInterval = null;
let settingsSyncInterval = null;

function startHeartbeat() {
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    heartbeatInterval = setInterval(async () => {
        if (!currentUserId) return;
        try {
            await db.from('users').update({ last_active: new Date().toISOString() }).eq('id', currentUserId);
        } catch(e) { console.log('[HB] err:', e); }
    }, 30000);
    if (currentUserId) {
        db.from('users').update({ last_active: new Date().toISOString() }).eq('id', currentUserId);
    }
}

function startSettingsSync() {
    if (settingsSyncInterval) clearInterval(settingsSyncInterval);
    settingsSyncInterval = setInterval(async () => {
        if (!currentUserId) return;
        try {
            cachedMonsterPool = await getMonsterPool();
            cachedPlayerStats = await getPlayerSettings();
        } catch(e) { console.log('[SYNC] err:', e); }
    }, 30000);
}

function stopHeartbeat() {
    if (heartbeatInterval) { clearInterval(heartbeatInterval); heartbeatInterval = null; }
    if (settingsSyncInterval) { clearInterval(settingsSyncInterval); settingsSyncInterval = null; }
}

// ===== 관리자: 유저 관리 =====
async function loadAdminUserList() {
    if (!window.isAdmin) return;
    try {
        const { data: users } = await db.from('users').select('*').order('last_active', { ascending: false });
        if (!users) return;
        const now = new Date();
        const threshold = 2 * 60 * 1000;
        let activeCount = 0, adminCount = 0;
        const listEl = document.getElementById('admin-user-list');
        listEl.innerHTML = '';
        users.forEach(u => {
            const la = new Date(u.last_active || u.last_login || u.created_at);
            const diff = now - la;
            const active = diff < threshold;
            if (active) activeCount++;
            if (u.is_admin) adminCount++;
            const tStr = active ? '접속 중' : fmtDiff(diff) + ' 전';
            const dot = active ? '🟢' : '⚫';
            const div = document.createElement('div');
            div.className = 'glass-panel';
            div.style.cssText = `padding:12px;margin-bottom:8px;border-color:${active?'rgba(0,255,100,0.2)':'rgba(255,255,255,0.05)'};`;
            div.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;">
                <div>
                    <div style="font-size:0.8rem;color:${u.is_admin?'var(--primary-gold)':'#e1e1f6'};font-weight:700;">${dot} ${u.username} ${u.is_admin?'👑':''}</div>
                    <div style="font-size:0.55rem;color:var(--text-dim);margin-top:3px;">${tStr} | 가입: ${new Date(u.created_at).toLocaleDateString('ko-KR')}</div>
                </div>
                ${!u.is_admin?`<button onclick="adminDeleteUser('${u.id}','${u.username}')" style="padding:6px 10px;font-size:0.55rem;background:rgba(255,50,50,0.15);border:1px solid rgba(255,50,50,0.3);border-radius:8px;color:var(--accent-red);cursor:pointer;">🗑 삭제</button>`:`<span style="font-size:0.5rem;color:var(--primary-gold);">ADMIN</span>`}
            </div>`;
            listEl.appendChild(div);
        });
        document.getElementById('admin-total-users').innerText = users.length;
        document.getElementById('admin-active-users').innerText = activeCount;
        document.getElementById('admin-admin-users').innerText = adminCount;
    } catch(e) { console.error('[ADMIN] err:', e); }
}

function fmtDiff(ms) {
    const s = Math.floor(ms/1000);
    if (s<60) return s+'초';
    const m = Math.floor(s/60);
    if (m<60) return m+'분';
    const h = Math.floor(m/60);
    if (h<24) return h+'시간';
    return Math.floor(h/24)+'일';
}

async function adminDeleteUser(uid, uname) {
    if (!window.isAdmin) return;
    if (!confirm(`⚠ "${uname}" 계정을 정말 삭제하시겠습니까?\n\n모든 데이터가 삭제됩니다.`)) return;
    if (!confirm(`최종 확인: "${uname}" 삭제`)) return;
    try {
        const { error: e0 } = await db.from('game_settings').delete().like('name', `%_${uid}`);
        if(e0 && e0.code !== 'PGRST116') console.error('Settings delete error:', e0);

        const { error: e1 } = await db.from('player_state').delete().eq('id', uid);
        if (e1) throw e1;

        const { error: e2 } = await db.from('users').delete().eq('id', uid);
        if (e2) throw e2;

        alert(`✅ "${uname}" 삭제 완료`);
        loadAdminUserList();
    } catch(e) { 
        console.error(e);
        alert('삭제 실패: ' + (e.message || JSON.stringify(e))); 
    }
}
