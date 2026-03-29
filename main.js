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
    { name: "고블린 병사", hp: 100, dmg: 8, img: "goblin_soldier_tactical.png", type: "normal" },
    { name: "고블린 궁수", hp: 70, dmg: 12, img: "goblin_archer_cloak.png", type: "normal" },
    { name: "대왕 고블린", hp: 250, dmg: 18, img: "great_goblin_boss.png", type: "boss" }
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
    
    // 유저 생성
    const { data: newUser, error } = await db.from('users').insert({ username, password_hash: hash, display_name: username }).select().single();
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
        const inv = await getInventory();
        await updateSelectedCardDisplay();
        updateClock();
        updateHuntLogUI();
        
        // 관리자 여부에 따라 설정 버튼 표시/숨김
        const settingsBtn = document.getElementById('btn-settings');
        if (settingsBtn) settingsBtn.style.display = window.isAdmin ? 'block' : 'none';
        
        // 실시간 동기화 시작
        startHeartbeat();
        startSettingsSync();
        
        // 카드가 없으면 인벤토리로 (카드 뽑기)
        if (inv.length === 0) {
            showScreen('inventory');
        } else {
            showScreen('main');
        }
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
        // 자동 로그인
        doLogin();
    }
}
initApp();

function showScreen(screenId) {
    activeScreen = screenId;
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const target = document.getElementById(`screen-${screenId}`);
    if (target) target.classList.add('active');
    if (screenId === 'dashboard') {
        setTimeout(() => { initMap(); startTracking(); loadPortals(); if (map) { map.invalidateSize(); map.setView(currentUserPos, 17); } }, 100);
    } else if (screenId === 'settings') {
        setTimeout(() => { initSettings(); renderCardEditor(); loadDropSettingsUI(); loadAdminUserList(); }, 100);
    } else if (screenId === 'inventory') {
        renderInventory();
    } else if (screenId === 'collection') {
        renderCollection();
    } else if (screenId === 'main') {
        updateSelectedCardDisplay();
    } else { stopTracking(); }
}

function initMap() {
    if (map) return;
    map = L.map('map', { zoomControl: false, attributionControl: false }).setView(currentUserPos, 13);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png').addTo(map);
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
        const hasBoss = names.some(n => { const m = pool.find(x => x.name === n); return m && m.type === 'boss'; });
        const hexColor = hasBoss ? '#ff4d4d' : '#00fdec';
        const cssColor = hasBoss ? 'var(--accent-red)' : 'var(--secondary-cyan)';
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
    selectedCardIdx = await getSelectedIdx();
    if (selectedCardIdx >= 0 && selectedCardIdx < inv.length) {
        const c = inv[selectedCardIdx];
        const e = getCardEffective(c);
        const bcn = document.getElementById('battle-card-name');
        if (bcn) bcn.innerText = c.name;
        const bcl = document.getElementById('battle-card-lv');
        if (bcl) bcl.innerText = `Lv.${c.level||1}`;
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
    const hc = document.getElementById('hunt-cards'); if(hc) hc.innerText = huntLog.cardsGot;
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
                        if (assignedNames.length > 0) monsterToSpawn = assignedNames[Math.floor(Math.random() * assignedNames.length)];
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
    const inv = await getInventory();
    selectedCardIdx = await getSelectedIdx();
    if (selectedCardIdx < 0 || selectedCardIdx >= inv.length) {
        alert('전투 카드가 없습니다! 인벤토리에서 선택하세요.');
        showScreen('main'); return;
    }
    const card = inv[selectedCardIdx];
    const playerData = await getPlayerSettings();
    const pool = await getMonsterPool();
    let targetMonster;
    if (forcedMonsterName) {
        targetMonster = pool.find(m => m.name === forcedMonsterName) || pool[0];
    } else {
        const normals = pool.filter(m => m.type !== 'boss');
        const p = normals.length > 0 ? normals : pool;
        targetMonster = p[Math.floor(Math.random() * p.length)];
    }
    // 몬스터 스탯 랜덤 생성
    const randBetween = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
    const mHp = randBetween(targetMonster.hpMin || targetMonster.hp || 100, targetMonster.hpMax || targetMonster.hp || 100);
    const mAtk = randBetween(targetMonster.atkMin || targetMonster.dmg || 10, targetMonster.atkMax || targetMonster.dmg || 10);
    const mDef = randBetween(targetMonster.defMin || 0, targetMonster.defMax || 0);
    combatState = {
        playerHP: card.hp, playerMaxHP: card.hp,
        playerAtk: card.atk, playerDef: card.def,
        skill1: card.skill1||'none', skill1Chance: card.skill1Chance||0,
        skill2: card.skill2||'none', skill2Chance: card.skill2Chance||0,
        potions: playerData.potions || 1,
        currentEnemy: { ...targetMonster, hp: mHp, maxHp: mHp, dmg: mAtk, def: mDef },
        isGameOver: false, busy: false,
        cardName: card.name, cardImg: card.img, cardRarity: card.rarity||'common'
    };
    // UI 업데이트 - 적
    document.getElementById('enemy-name-label').innerText = combatState.currentEnemy.name;
    document.getElementById('enemy-img-main').src = combatState.currentEnemy.img;
    document.getElementById('enemy-img-main').style.opacity = '1';
    const isBoss = combatState.currentEnemy.type === 'boss';
    const nameLabel = document.getElementById('enemy-name-label');
    if (isBoss) { nameLabel.style.color = 'var(--primary-gold)'; nameLabel.innerText = `⚔ ${combatState.currentEnemy.name} [BOSS]`; }
    else { nameLabel.style.color = 'var(--accent-red)'; }
    // UI - 내 카드
    const pn = document.getElementById('player-card-name'); if(pn) pn.innerText = card.name;
    const pr = document.getElementById('player-card-rarity'); if(pr) { pr.innerText = `[${rarityLabel(card.rarity)}]`; pr.style.color = rarityColor(card.rarity); }
    const pi = document.getElementById('player-card-img'); if(pi) { pi.src = card.img; pi.style.borderColor = rarityColor(card.rarity); }
    updateCombatUI();
    document.getElementById('combat-log').innerHTML = `<div class="log-entry">${card.name} [${rarityLabel(card.rarity)}] ${isBoss ? 'vs ⚔ BOSS!' : '전투 개시!'}</div>`;
    playSound('swordSwing'); showScreen('combat');
    // 항상 자동전투 시작
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
function triggerShake() { const s = document.querySelector('.combat-scene'); if(s) { s.classList.add('shake'); setTimeout(() => s.classList.remove('shake'), 400); } }

function executeEnemyTurn() {
    if (combatState.isGameOver) return;
    combatState.busy = true;
    const enemy = combatState.currentEnemy;
    let raw = Math.floor(Math.random() * 5) + enemy.dmg;
    // 회피 체크 (skill1 or skill2)
    const dodgeChance = (combatState.skill1==='dodge'?combatState.skill1Chance:0) + (combatState.skill2==='dodge'?combatState.skill2Chance:0);
    if (dodgeChance > 0 && Math.random()*100 < dodgeChance) {
        renderLog(`💨 ${combatState.cardName} 회피!`, 'player');
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
    // 기술1 체크
    if (combatState.skill1!=='none' && Math.random()*100 < combatState.skill1Chance) {
        dmg = applySkill(combatState.skill1, dmg, 'skill1');
    }
    // 기술2 체크
    if (combatState.skill2!=='none' && Math.random()*100 < combatState.skill2Chance) {
        dmg = applySkill(combatState.skill2, dmg, 'skill2');
    }
    enemy.hp = Math.max(0, enemy.hp - dmg);
    // 흡혈 처리
    if ((combatState.skill1==='drain'||combatState.skill2==='drain') && dmg > 0) {
        healAmt = Math.floor(dmg*0.3);
        combatState.playerHP = Math.min(combatState.playerMaxHP, combatState.playerHP + healAmt);
    }
    playSound('swordSwing'); setTimeout(() => playSound('hit'), 150);
    const img = document.getElementById('enemy-img-main');
    if(img) { img.classList.add('shake'); setTimeout(() => img.classList.remove('shake'), 400); }
    renderLog(`${combatState.cardName} 공격! ${dmg} 대미지${healAmt?` (+${healAmt} 흡혈)`:''}`, 'player');
    updateCombatUI();
    if (enemy.hp <= 0) {
        combatState.busy = false;
        handleVictory();
    } else {
        setTimeout(() => { combatState.busy = false; executeEnemyTurn(); }, 1000);
    }
}
function applySkill(skill, dmg, label) {
    if (skill==='double_attack') {
        const d2 = Math.floor(Math.random()*8)+combatState.playerAtk;
        renderLog(`⚔ 이중 어택! +${d2}`, 'player');
        return dmg+d2;
    } else if (skill==='magic_attack') {
        renderLog('🔮 마법 공격! 방어무시', 'player');
        return Math.floor(dmg*1.5);
    } else if (skill==='critical') {
        renderLog('💥 크리티컬! 2배', 'player');
        return dmg*2;
    }
    return dmg;
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
    const isBoss = combatState.currentEnemy.type === 'boss';
    if (isBoss) huntLog.bossKills++;
    
    try {
        // 카드 드랍 (등급별)
        const droppedCards = await rollCardDrop(combatState.currentEnemy.name, isBoss);
        droppedCards.forEach(d => {
            huntLog.cardsGot++;
            renderLog(`🃏 [${rarityLabel(d.rarity)}] ${d.name} 카드 획득!`, 'player');
            playSound('victory');
        });
        if (droppedCards.length === 0) renderLog('카드 드랍 없음', 'enemy');
        
        // 포션 드랍
        const dropS = await getDropSettings();
        let stats = await getPlayerSettings();
        if (Math.random() * 100 < (dropS.potionDrop||30)) {
            stats.potions = (stats.potions||0) + 1;
            huntLog.potions++;
            renderLog('포션 드랍!', 'player');
        }
        await db.from('player_state').update(stats).eq('id', currentUserId||'singleton');
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
    pool.forEach((m, i) => {
        const isBoss = m.type === 'boss';
        const item = document.createElement('div');
        item.className = 'glass-panel monster-card';
        item.style.cssText = `margin-bottom:15px; padding:20px; ${isBoss ? 'border-left:4px solid var(--primary-gold); box-shadow:0 0 15px rgba(233,196,0,0.1);' : 'border-left:4px solid var(--secondary-cyan);'}`;
        item.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
                <div style="display:flex; align-items:center; gap:10px;">
                    <span style="font-size:0.8rem; padding:4px 12px; border-radius:20px; font-weight:700;
                        background:${isBoss ? 'rgba(233,196,0,0.2)' : 'rgba(0,253,236,0.15)'}; 
                        color:${isBoss ? 'var(--primary-gold)' : 'var(--secondary-cyan)'}; 
                        border:1px solid ${isBoss ? 'rgba(233,196,0,0.4)' : 'rgba(0,253,236,0.3)'};">
                        ${isBoss ? '⚔ BOSS' : '🗡 NORMAL'}
                    </span>
                    <span style="font-size:0.75rem; color:var(--text-dim);">#${i+1}</span>
                </div>
                <button class="btn-nav" style="padding:6px 14px; font-size:0.75rem; color:var(--accent-red); border-color:var(--accent-red);" onclick="deleteMonster(${i})">삭제</button>
            </div>
            <div style="display:flex; gap:15px; align-items:flex-start;">
                <div style="flex-shrink:0; text-align:center;">
                    <img src="${m.img}" style="width:80px; height:80px; object-fit:contain; border-radius:12px; background:rgba(0,0,0,0.4); border:1px solid var(--glass-border);"
                        onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 80 80%22><text x=%2240%22 y=%2250%22 text-anchor=%22middle%22 font-size=%2240%22>👾</text></svg>'">
                    <label class="btn-nav" style="display:block; margin-top:8px; padding:6px 10px; font-size:0.7rem; cursor:pointer; text-align:center; border-color:var(--secondary-cyan); color:var(--secondary-cyan);">
                        이미지 변경
                        <input type="file" accept="image/*" style="display:none;" onchange="uploadMonsterImage(${i}, this)">
                    </label>
                </div>
                <div style="flex:1;">
                    <div style="margin-bottom:10px;">
                        <label>몬스터 이름</label>
                        <input type="text" class="set-m-name btn-nav" data-index="${i}" value="${m.name}" style="width:100%;">
                    </div>
                    <div style="font-size:0.8rem; color:var(--secondary-cyan); margin-bottom:6px; font-weight:700;">📊 능력치 범위 (최소 ~ 최대)</div>
                    <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-bottom:8px;">
                        <div><label>HP min</label><input type="number" class="set-m-hpmin btn-nav" data-index="${i}" value="${m.hpMin||m.hp||100}" style="width:100%;"></div>
                        <div><label>HP max</label><input type="number" class="set-m-hpmax btn-nav" data-index="${i}" value="${m.hpMax||m.hp||100}" style="width:100%;"></div>
                    </div>
                    <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-bottom:8px;">
                        <div><label>ATK min</label><input type="number" class="set-m-atkmin btn-nav" data-index="${i}" value="${m.atkMin||m.dmg||10}" style="width:100%;"></div>
                        <div><label>ATK max</label><input type="number" class="set-m-atkmax btn-nav" data-index="${i}" value="${m.atkMax||m.dmg||10}" style="width:100%;"></div>
                    </div>
                    <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
                        <div><label>DEF min</label><input type="number" class="set-m-defmin btn-nav" data-index="${i}" value="${m.defMin||0}" style="width:100%;"></div>
                        <div><label>DEF max</label><input type="number" class="set-m-defmax btn-nav" data-index="${i}" value="${m.defMax||0}" style="width:100%;"></div>
                    </div>
                </div>
            </div>
        `;
        container.appendChild(item);
    });
}

async function uploadMonsterImage(index, input) {
    const file = input.files[0]; if (!file) return;
    const ext = file.name.split('.').pop();
    const fileName = `monster_${index}_${Date.now()}.${ext}`;
    const card = input.closest('.monster-card');
    const img = card.querySelector('img'); img.style.opacity = '0.3';
    try {
        const { error } = await db.storage.from('monster-images').upload(fileName, file, { cacheControl: '3600', upsert: true });
        if (error) { alert('업로드 실패: ' + error.message); img.style.opacity = '1'; return; }
        const { data: urlData } = db.storage.from('monster-images').getPublicUrl(fileName);
        const pool = await getMonsterPool();
        pool[index].img = urlData.publicUrl;
        await db.from('game_settings').update({ value: pool }).eq('name', 'monsterPool');
        img.src = urlData.publicUrl; img.style.opacity = '1';
    } catch(e) { alert('에러: ' + e.message); img.style.opacity = '1'; }
}

async function addMonster(type) {
    const pool = await getMonsterPool();
    pool.push({
        name: type === 'boss' ? '새 보스 몬스터' : '새 일반 몬스터',
        hpMin: type === 'boss' ? 200 : 80, hpMax: type === 'boss' ? 300 : 120,
        atkMin: type === 'boss' ? 15 : 8, atkMax: type === 'boss' ? 25 : 14,
        defMin: type === 'boss' ? 5 : 0, defMax: type === 'boss' ? 10 : 3,
        img: '', type
    });
    await db.from('game_settings').update({ value: pool }).eq('name', 'monsterPool');
    renderSettingsMonsterList();
}
async function deleteMonster(i) {
    if (!confirm('삭제하시겠습니까?')) return;
    const pool = await getMonsterPool(); pool.splice(i, 1);
    await db.from('game_settings').update({ value: pool }).eq('name', 'monsterPool');
    renderSettingsMonsterList();
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
    });
    await db.from('game_settings').update({ value: pool }).eq('name', 'monsterPool');
    cachedMonsterPool = pool;
    alert("몬스터 데이터 저장 완료!"); renderSettingsMonsterList();
}

function initSettingsMap() {
    if (setMap) return;
    setMap = L.map('set-map', { zoomControl: true }).setView(currentUserPos, 13);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png').addTo(setMap);
    setMap.on('click', async (e) => {
        const name = prompt("지역 이름:", `탐사구역_${Math.floor(Math.random()*1000)}`);
        if (name) {
            await db.from('portals').insert({ id: Date.now(), name, lat: e.latlng.lat, lng: e.latlng.lng, mission_text: "이 지역의 위협 요소를 제거하십시오.", radius: 100, spawn_chance: 0.5, spawn_distance_requirement: 20 });
            renderSettingsPortalList();
        }
    });
}

async function renderSettingsPortalList() {
    const portals = await getPortals();
    const pool = await getMonsterPool();
    const container = document.getElementById('set-portal-list');
    container.innerHTML = '';
    setMap.eachLayer((layer) => { if (layer instanceof L.Marker || layer instanceof L.Circle) setMap.removeLayer(layer); });
    portals.forEach(p => {
        const assignedNames = parsePortalMonsters(p.target_monster_name);
        const hasBoss = assignedNames.some(n => { const m = pool.find(x => x.name === n); return m && m.type === 'boss'; });
        const normalAssigned = assignedNames.filter(n => { const m = pool.find(x => x.name === n); return m && m.type !== 'boss'; });
        const bossAssigned = assignedNames.filter(n => { const m = pool.find(x => x.name === n); return m && m.type === 'boss'; });
        const item = document.createElement('div');
        item.className = 'glass-panel';
        item.style.cssText = `margin-bottom:12px; padding:14px 16px; ${hasBoss ? 'border-left:4px solid var(--primary-gold); background:rgba(233,196,0,0.03);' : ''}`;
        let monsterTags = '';
        if (normalAssigned.length > 0) monsterTags += normalAssigned.map(n => `<span style="font-size:0.5rem; padding:2px 8px; border-radius:10px; background:rgba(0,253,236,0.1); color:var(--secondary-cyan); border:1px solid rgba(0,253,236,0.2); margin-right:4px;">🗡 ${n}</span>`).join('');
        if (bossAssigned.length > 0) monsterTags += bossAssigned.map(n => `<span style="font-size:0.5rem; padding:2px 8px; border-radius:10px; background:rgba(233,196,0,0.15); color:var(--primary-gold); border:1px solid rgba(233,196,0,0.3); margin-right:4px;">⚔ ${n}</span>`).join('');
        if (assignedNames.length === 0) monsterTags = '<span style="font-size:0.5rem; color:var(--text-dim);">랜덤 일반 몬스터</span>';
        item.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:flex-start;">
                <div style="flex:1;">
                    <div style="font-size:0.8rem; color:${hasBoss ? 'var(--primary-gold)' : '#fff'}; font-weight:${hasBoss ? '700' : '400'}; margin-bottom:4px;">
                        ${p.name} ${hasBoss ? '<span style="font-size:0.55rem;">[BOSS ZONE]</span>' : ''}
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
        const mc = hasBoss ? '#ff4d4d' : '#00fdec';
        // 설정 맵에도 반경 원 표시
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
        L.marker([p.lat, p.lng], { icon: mi }).addTo(setMap).bindPopup(`<b>${p.name}</b><br>${hasBoss ? '⚔ BOSS ZONE' : '일반 구역'}<br>반경: ${p.radius || 100}m`);
    });
}

let editingPortalId = null;
async function openPortalEditor(id) {
    editingPortalId = id;
    const portals = await getPortals();
    const p = portals.find(x => x.id == id);
    const pool = await getMonsterPool();
    const assignedNames = parsePortalMonsters(p.target_monster_name);
    document.getElementById('ed-p-name').value = p.name;
    document.getElementById('ed-p-mission').value = p.mission_text || "";
    document.getElementById('ed-p-radius').value = p.radius || 100;
    document.getElementById('ed-p-walk').value = p.spawn_distance_requirement || 20;
    document.getElementById('ed-p-chance').value = Math.round((p.spawn_chance ?? 1) * 100);
    const normalContainer = document.getElementById('ed-normal-monsters');
    const bossContainer = document.getElementById('ed-boss-monsters');
    normalContainer.innerHTML = ''; bossContainer.innerHTML = '';
    const normals = pool.filter(m => m.type !== 'boss');
    const bosses = pool.filter(m => m.type === 'boss');
    if (normals.length === 0) normalContainer.innerHTML = '<div style="font-size:0.6rem; color:var(--text-dim);">일반 몬스터 없음</div>';
    normals.forEach(m => {
        const checked = assignedNames.includes(m.name) ? 'checked' : '';
        normalContainer.innerHTML += `<label style="display:flex; align-items:center; gap:10px; padding:10px 12px; background:rgba(0,253,236,0.03); border:1px solid rgba(0,253,236,0.1); border-radius:10px; cursor:pointer; margin-bottom:6px;">
            <input type="checkbox" class="ed-monster-check" value="${m.name}" data-type="normal" ${checked} style="width:18px; height:18px; accent-color:var(--secondary-cyan);">
            <img src="${m.img}" style="width:32px; height:32px; object-fit:contain; border-radius:6px; background:rgba(0,0,0,0.3);" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 32 32%22><text x=%2216%22 y=%2222%22 text-anchor=%22middle%22 font-size=%2218%22>👾</text></svg>'">
            <div><div style="font-size:0.75rem; color:#fff;">${m.name}</div><div style="font-size:0.5rem; color:var(--text-dim);">HP:${m.hp} ATK:${m.dmg}</div></div></label>`;
    });
    if (bosses.length === 0) bossContainer.innerHTML = '<div style="font-size:0.6rem; color:var(--text-dim);">보스 몬스터 없음</div>';
    bosses.forEach(m => {
        const checked = assignedNames.includes(m.name) ? 'checked' : '';
        bossContainer.innerHTML += `<label style="display:flex; align-items:center; gap:10px; padding:10px 12px; background:rgba(233,196,0,0.05); border:1px solid rgba(233,196,0,0.15); border-radius:10px; cursor:pointer; margin-bottom:6px;">
            <input type="checkbox" class="ed-monster-check" value="${m.name}" data-type="boss" ${checked} style="width:18px; height:18px; accent-color:var(--primary-gold);">
            <img src="${m.img}" style="width:32px; height:32px; object-fit:contain; border-radius:6px; background:rgba(0,0,0,0.3);" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 32 32%22><text x=%2216%22 y=%2222%22 text-anchor=%22middle%22 font-size=%2218%22>👹</text></svg>'">
            <div><div style="font-size:0.75rem; color:var(--primary-gold); font-weight:700;">⚔ ${m.name}</div><div style="font-size:0.5rem; color:var(--text-dim);">HP:${m.hp} ATK:${m.dmg} | 정령카드 100%</div></div></label>`;
    });
    document.getElementById('portal-editor-modal').style.display = 'block';
}
function closePortalEditor() { document.getElementById('portal-editor-modal').style.display = 'none'; }
async function applyPortalEdit() {
    const checks = document.querySelectorAll('.ed-monster-check:checked');
    const selectedNames = Array.from(checks).map(c => c.value);
    const chancePct = parseInt(document.getElementById('ed-p-chance').value) || 50;
    const data = {
        name: document.getElementById('ed-p-name').value,
        mission_text: document.getElementById('ed-p-mission').value,
        radius: parseInt(document.getElementById('ed-p-radius').value),
        spawn_distance_requirement: parseInt(document.getElementById('ed-p-walk').value),
        spawn_chance: Math.min(100, Math.max(1, chancePct)) / 100,
        target_monster_name: selectedNames.length > 0 ? JSON.stringify(selectedNames) : null
    };
    await db.from('portals').update(data).eq('id', editingPortalId);
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
        await db.from('player_state').delete().eq('id', uid);
        await db.from('users').delete().eq('id', uid);
        alert(`✅ "${uname}" 삭제 완료`);
        loadAdminUserList();
    } catch(e) { alert('삭제 실패: ' + e.message); }
}
