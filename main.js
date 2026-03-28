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

// ===== 세션 사냥 기록 =====
let huntLog = { kills: 0, bossKills: 0, potions: 0, spiritCards: 0, xpTotal: 0 };

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
    const { data } = await db.from('player_state').select('*').eq('id', 'singleton').single();
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

async function initApp() {
    try {
        cachedMonsterPool = await getMonsterPool();
        cachedPlayerStats = await getPlayerSettings();
    } catch(e) { console.log("Init warning:", e); }
    updateClock();
    await updateDashboardHUD();
    updateHuntLogUI();
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
        setTimeout(() => initSettings(), 100);
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
            const newPos = [pos.coords.latitude, pos.coords.longitude];
            const distMoved = L.latLng(lastWalkPos).distanceTo(newPos);
            if (distMoved > 2 && activeMissionPortalId) { walkAccumulator += distMoved; lastWalkPos = newPos; }
            else if (!activeMissionPortalId) { lastWalkPos = newPos; }
            currentUserPos = newPos;
            if (userMarker) userMarker.setLatLng(currentUserPos);
            if (accuracyCircle) { accuracyCircle.setLatLng(currentUserPos); accuracyCircle.setRadius(pos.coords.accuracy); }
            if (map && activeScreen === 'dashboard') map.panTo(currentUserPos);
            checkProximity();
            updateDashboardHUD();
        }, (err) => console.error("GPS_ERROR:", err), { enableHighAccuracy: true, maximumAge: 0 });
    }
}

async function updateDashboardHUD() {
    const stats = await getPlayerSettings();
    cachedPlayerStats = stats;
    const mainLevel = document.getElementById('main-level');
    if (mainLevel) mainLevel.innerText = stats.level || 1;
    const hudSpirit = document.getElementById('hud-spirit-cards');
    if (hudSpirit) hudSpirit.innerText = stats.spirit_cards || 0;
    const xpNeeded = (stats.level || 1) * 100;
    const xpPercent = Math.min(100, ((stats.xp || 0) / xpNeeded) * 100);
    const mainXpBar = document.getElementById('main-xp-bar');
    if (mainXpBar) mainXpBar.style.width = `${xpPercent}%`;
    const hudLevel = document.getElementById('hud-level');
    if (hudLevel) hudLevel.innerText = stats.level || 1;
    const hpText = document.getElementById('hud-hp-text');
    if (hpText) hpText.innerText = `${Math.ceil((combatState.playerHP/combatState.playerMaxHP)*100)}%`;
    const hpBar = document.getElementById('hud-hp-bar');
    if (hpBar) hpBar.style.width = `${(combatState.playerHP/combatState.playerMaxHP)*100}%`;
    const xpBar = document.getElementById('xp-bar');
    if (xpBar) xpBar.style.width = `${xpPercent}%`;
}

// ===== 사냥 기록 UI 업데이트 =====
function updateHuntLogUI() {
    const el = document.getElementById('hunt-log-panel');
    if (!el) return;
    document.getElementById('hunt-kills').innerText = huntLog.kills;
    document.getElementById('hunt-boss-kills').innerText = huntLog.bossKills;
    document.getElementById('hunt-potions').innerText = huntLog.potions;
    document.getElementById('hunt-spirit').innerText = huntLog.spiritCards;
    document.getElementById('hunt-xp').innerText = huntLog.xpTotal;
}

// ===== PROXIMITY / ENCOUNTER =====
let proximityRunning = false;
async function checkProximity() {
    if (activeScreen !== 'dashboard') return;
    if (encounterPending || proximityRunning) return;
    proximityRunning = true;
    try {
        const portals = await getPortals();
        let nearestDist = Infinity, insidePortal = null;
        portals.forEach(p => {
            const dist = L.latLng(currentUserPos).distanceTo(L.latLng(p.lat, p.lng));
            if (dist < nearestDist) nearestDist = dist;
            if (dist < (p.radius || 100)) insidePortal = p;
            else {
                if (ignoredPortalIds.has(p.id) && dist > (p.radius || 100) * 1.5) ignoredPortalIds.delete(p.id);
                if (activeMissionPortalId === p.id && dist > (p.radius || 100)) { activeMissionPortalId = null; walkAccumulator = 0; }
            }
        });
        const statusText = document.getElementById('distance-info');
        if (statusText) statusText.innerText = (nearestDist === Infinity) ? "주변 신호: 없음" : `근처 신호: ${Math.round(nearestDist)}m 거리`;
        const missionOverlay = document.getElementById('mission-overlay');
        const confirmModal = document.getElementById('portal-confirm-modal');

        if (insidePortal) {
            currentMissionPortal = insidePortal;
            if (activeMissionPortalId === insidePortal.id) {
                missionOverlay.style.display = 'block';
                confirmModal.style.display = 'none';
                document.getElementById('mission-title').innerText = insidePortal.name;
                document.getElementById('mission-desc').innerText = insidePortal.mission_text || "이 지역을 조사하십시오.";
                const targetDist = insidePortal.spawn_distance_requirement || 20;
                document.getElementById('mission-walk-dist').innerText = Math.floor(walkAccumulator);
                document.getElementById('mission-target-dist').innerText = targetDist;
                document.getElementById('mission-xp-bar').style.width = `${Math.min(100, (walkAccumulator / targetDist) * 100)}%`;

                if (walkAccumulator >= targetDist) {
                    encounterPending = true;
                    const assignedNames = parsePortalMonsters(insidePortal.target_monster_name);
                    let monsterToSpawn = null;
                    if (assignedNames.length > 0) {
                        monsterToSpawn = assignedNames[Math.floor(Math.random() * assignedNames.length)];
                    }
                    console.log('[ENCOUNTER] 게이지 충족! monster:', monsterToSpawn);
                    
                    // ★ 인카운터 시 진동 + 알람
                    triggerPortalAlert();
                    
                    document.getElementById('map-status').innerHTML = `<span style="color: var(--accent-red); animation: pulse 1s infinite; font-weight:bold;">[!] 적의 기습! 자동전투 진입...</span>`;
                    missionOverlay.style.display = 'none';
                    // ★ 인카운터 → 자동전투 모드로 즉시 진입
                    setTimeout(() => { walkAccumulator = 0; activeMissionPortalId = null; encounterPending = false; startCombat(monsterToSpawn, true); }, 1200);
                    proximityRunning = false;
                    return;
                }
            } else if (!ignoredPortalIds.has(insidePortal.id) && pendingConfirmationPortalId !== insidePortal.id) {
                pendingConfirmationPortalId = insidePortal.id;
                document.getElementById('confirm-portal-name').innerText = insidePortal.name;
                
                // ★ 포탈 감지 시에도 진동
                if ('vibrate' in navigator) navigator.vibrate([100, 50, 100]);
                
                confirmModal.style.display = 'flex';
                missionOverlay.style.display = 'none';
            }
        } else {
            currentMissionPortal = null; pendingConfirmationPortalId = null;
            confirmModal.style.display = 'none'; missionOverlay.style.display = 'none';
            document.getElementById('map-status').innerText = "시스템 온라인 // 신호 분석 중";
        }
    } finally { proximityRunning = false; }
}

function acceptMission() {
    if (currentMissionPortal) {
        activeMissionPortalId = currentMissionPortal.id;
        pendingConfirmationPortalId = null;
        walkAccumulator = 0; lastWalkPos = currentUserPos;
        document.getElementById('portal-confirm-modal').style.display = 'none';
        
        // ★ 미션 수락 시 진동
        if ('vibrate' in navigator) navigator.vibrate(200);
        
        checkProximity();
    }
}
function ignoreMission() {
    if (currentMissionPortal) {
        ignoredPortalIds.add(currentMissionPortal.id);
        pendingConfirmationPortalId = null;
        document.getElementById('portal-confirm-modal').style.display = 'none';
    }
}
function stopTracking() { if (watchId) navigator.geolocation.clearWatch(watchId); }

// ===== COMBAT — autoStart 파라미터 추가 =====
async function startCombat(forcedMonsterName = null, autoStart = false) {
    const playerStats = await getPlayerSettings();
    const pool = await getMonsterPool();
    let targetMonster;
    if (forcedMonsterName) {
        targetMonster = pool.find(m => m.name === forcedMonsterName) || pool[0];
    } else {
        const normals = pool.filter(m => m.type !== 'boss');
        const p = normals.length > 0 ? normals : pool;
        targetMonster = p[Math.floor(Math.random() * p.length)];
    }
    combatState = {
        playerHP: playerStats.hp, playerMaxHP: playerStats.hp,
        playerAtk: playerStats.atk, playerDef: playerStats.def,
        potions: playerStats.potions,
        currentEnemy: { ...targetMonster, hp: targetMonster.hp, maxHp: targetMonster.hp },
        isGameOver: false, isAuto: false
    };
    document.getElementById('enemy-name-label').innerText = combatState.currentEnemy.name;
    document.getElementById('enemy-img-main').src = combatState.currentEnemy.img;
    document.getElementById('enemy-img-main').style.opacity = "1";
    document.getElementById('btn-auto-battle').innerText = "AUTO: OFF";
    document.getElementById('btn-auto-battle').style.background = "var(--bg-space)";
    const isBoss = combatState.currentEnemy.type === 'boss';
    const nameLabel = document.getElementById('enemy-name-label');
    if (isBoss) { nameLabel.style.color = 'var(--primary-gold)'; nameLabel.innerText = `⚔ ${combatState.currentEnemy.name} [BOSS]`; }
    else { nameLabel.style.color = 'var(--accent-red)'; }
    stopAutoBattle(); updateCombatUI();
    document.getElementById('combat-log').innerHTML = `<div class="log-entry">${isBoss ? '⚔ 강력한 보스가 나타났다!' : '전장에 진입했습니다. TARGET_ACQUIRED!'}</div>`;
    playSound('swordSwing'); showScreen('combat');
    
    // ★ 포탈에서 진입한 경우 자동전투 즉시 시작
    if (autoStart) {
        setTimeout(() => {
            toggleAutoBattle();
            renderLog('🤖 자동전투 모드 활성화!', 'player');
        }, 800);
    }
}

async function usePotion() {
    if (combatState.isGameOver || combatState.busy || combatState.potions <= 0) return;
    combatState.busy = true; updateActionButtons(false);
    const heal = Math.floor(combatState.playerMaxHP * 0.5);
    combatState.playerHP = Math.min(combatState.playerMaxHP, combatState.playerHP + heal);
    combatState.potions--;
    await db.from('player_state').update({ potions: combatState.potions }).eq('id', 'singleton');
    playSound('potion'); renderLog(`나노봇 포션! HP +${heal}`, "player"); updateCombatUI();
    setTimeout(() => { combatState.busy = false; executeEnemyTurn(); }, 1000);
}
function updateActionButtons(enabled) {
    const a = document.getElementById('btn-attack'), p = document.getElementById('btn-potion');
    if (a) a.disabled = !enabled; if (p) p.disabled = !enabled || combatState.potions <= 0;
}
function playSound(name) { if (SOUNDS[name]) { SOUNDS[name].currentTime = 0; SOUNDS[name].play().catch(() => {}); } }
function triggerShake() { const s = document.querySelector('.combat-scene'); if(s) { s.classList.add('shake'); setTimeout(() => s.classList.remove('shake'), 400); } }

function executeEnemyTurn() {
    if (combatState.isGameOver) return;
    combatState.busy = true; updateActionButtons(false);
    const enemy = combatState.currentEnemy;
    let raw = Math.floor(Math.random() * 5) + enemy.dmg;
    let dmg = Math.max(1, raw - Math.floor(raw * (combatState.playerDef / 100)));
    combatState.playerHP = Math.max(0, combatState.playerHP - dmg);
    triggerShake(); playSound('enemyHit');
    const scene = document.querySelector('.combat-scene');
    if(scene) { scene.classList.add('flash-red', 'glitch'); setTimeout(() => scene.classList.remove('flash-red', 'glitch'), 300); }
    renderLog(`${enemy.name}의 공격! ${dmg} 대미지.`, "enemy");
    if (combatState.playerHP <= 0) {
        renderLog("심각한 손상! 후퇴.", "enemy");
        combatState.isGameOver = true;
        stopAutoBattle();
        // 패배 시에도 진동
        if ('vibrate' in navigator) navigator.vibrate([500, 200, 500]);
        setTimeout(() => { showScreen('dashboard'); }, 2000);
    } else {
        // 자동전투 중이면 포션 자동 사용 (HP 30% 이하)
        if (combatState.isAuto && combatState.potions > 0 && (combatState.playerHP / combatState.playerMaxHP) < 0.3) {
            setTimeout(() => { usePotion(); }, 500);
        } else {
            setTimeout(() => { combatState.busy = false; updateActionButtons(true); }, 500);
        }
    }
    updateCombatUI();
}

function toggleAutoBattle() {
    combatState.isAuto = !combatState.isAuto;
    const btn = document.getElementById('btn-auto-battle');
    if (combatState.isAuto) { 
        btn.innerText = "AUTO: ON"; 
        btn.style.background = "rgba(0,253,236,0.2)";
        btn.style.color = "var(--secondary-cyan)";
        autoBattleInterval = setInterval(() => { 
            if (!combatState.isGameOver && !combatState.busy) executePlayerTurn(); 
            else if (combatState.isGameOver) stopAutoBattle(); 
        }, 1200);
    } else stopAutoBattle();
}
function stopAutoBattle() {
    combatState.isAuto = false;
    const btn = document.getElementById('btn-auto-battle');
    if (btn) { btn.innerText = "AUTO: OFF"; btn.style.background = "var(--bg-space)"; btn.style.color = ""; }
    if (autoBattleInterval) clearInterval(autoBattleInterval); autoBattleInterval = null;
}

function executePlayerTurn() {
    if (combatState.isGameOver || combatState.busy) return;
    combatState.busy = true; updateActionButtons(false);
    let enemy = combatState.currentEnemy;
    let dmg = Math.floor(Math.random() * 10) + combatState.playerAtk;
    enemy.hp = Math.max(0, enemy.hp - dmg);
    playSound('swordSwing'); setTimeout(() => playSound('hit'), 150);
    const img = document.getElementById('enemy-img-main'); 
    if(img) { img.classList.add('shake'); setTimeout(() => img.classList.remove('shake'), 400); }
    renderLog(`검을 휘둘러 ${dmg} 데미지!`, "player"); updateCombatUI();
    if (enemy.hp <= 0) handleVictory();
    else setTimeout(() => { combatState.busy = false; executeEnemyTurn(); }, 1000);
}

async function handleVictory() {
    playSound('victory'); renderLog("전투 승리!", "player");
    combatState.isGameOver = true; 
    const eImg = document.getElementById('enemy-img-main');
    if(eImg) eImg.style.opacity = "0";
    
    // ★ 승리 시 진동
    if ('vibrate' in navigator) navigator.vibrate([100, 50, 100, 50, 200]);
    
    let stats = await getPlayerSettings();
    const xp = 30 + Math.floor(Math.random() * 20);
    stats.xp = (stats.xp || 0) + xp; renderLog(`경험치 +${xp}`, "player");
    
    // 사냥 기록 업데이트
    huntLog.kills++;
    huntLog.xpTotal += xp;
    
    const xpNeeded = (stats.level || 1) * 100;
    if (stats.xp >= xpNeeded) { stats.level++; stats.xp -= xpNeeded; stats.hp += 20; stats.atk += 5; renderLog(`LEVEL ${stats.level} 달성!`, "player"); }
    
    // 보스 처치 → 정령카드 100%
    if (combatState.currentEnemy.type === 'boss') {
        stats.spirit_cards = (stats.spirit_cards || 0) + 1;
        huntLog.bossKills++;
        huntLog.spiritCards++;
        renderLog("★ 보스 처치! [정령 카드] 확보!", "player"); playSound('victory');
    }
    
    const loot = await getLootSettings();
    if (loot.fixed || Math.random() < loot.chance) { 
        stats.potions++; 
        huntLog.potions++;
        renderLog("포션 획득!", "player"); 
    }
    
    await db.from('player_state').update(stats).eq('id', 'singleton');
    updateDashboardHUD();
    updateHuntLogUI();
    
    // 자동전투 중이면 바로 대시보드로 복귀
    const wasAuto = combatState.isAuto;
    stopAutoBattle();
    
    setTimeout(() => { 
        if (combatState.isGameOver) { 
            showScreen('dashboard');
        } 
    }, wasAuto ? 2000 : 4000); // 자동전투면 더 빨리 복귀
}

function updateCombatUI() {
    const e = combatState.currentEnemy; if (!e) return;
    const eb = document.getElementById('enemy-hp-bar'); if (eb) eb.style.width = (e.hp/e.maxHp*100)+"%";
    const pb = document.getElementById('hud-hp-bar'); const pp = combatState.playerHP/combatState.playerMaxHP*100;
    if (pb) pb.style.width = pp+"%";
    const ht = document.getElementById('hud-hp-text'); if (ht) ht.innerText = Math.round(pp)+"%";
    const pot = document.getElementById('btn-potion'); if (pot) { pot.innerText = `HEAL (${combatState.potions})`; pot.disabled = combatState.potions <= 0; }
    const ml = document.getElementById('main-level'); if (ml && cachedPlayerStats) ml.innerText = cachedPlayerStats.level || 1;
}
function renderLog(msg, type) { const log = document.getElementById('combat-log'); if(!log) return; const e = document.createElement('div'); e.className = `log-entry ${type}`; e.innerText = msg; log.prepend(e); }
function updateClock() { const t = document.getElementById('system-time'); if (t) { const n = new Date(); t.innerText = n.toTimeString().split(' ')[0] + " // " + n.toLocaleDateString('ko-KR'); } }
setInterval(updateClock, 1000); updateClock();
window.addEventListener('resize', () => { if (map) map.invalidateSize(); if (setMap) setMap.invalidateSize(); });

// ===== SETTINGS =====
let setMap;
async function initSettings() {
    const p = await getPlayerSettings();
    document.getElementById('set-p-hp').value = p.hp;
    document.getElementById('set-p-atk').value = p.atk;
    document.getElementById('set-p-def').value = p.def;
    document.getElementById('set-p-pot').value = p.potions;
    const l = await getLootSettings();
    document.getElementById('set-l-chance').value = l.chance;
    document.getElementById('set-l-fixed').checked = l.fixed;
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
        item.style.cssText = `margin-bottom:15px; padding:20px; ${isBoss ? 'border-left:4px solid var(--primary-gold); box-shadow:0 0 15px rgba(233,196,0,0.1);' : ''}`;
        item.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">
                <div style="display:flex; align-items:center; gap:10px;">
                    <span style="font-size:0.6rem; padding:3px 10px; border-radius:20px; font-weight:700; letter-spacing:1px;
                        background:${isBoss ? 'rgba(233,196,0,0.2)' : 'rgba(0,253,236,0.15)'}; 
                        color:${isBoss ? 'var(--primary-gold)' : 'var(--secondary-cyan)'}; 
                        border:1px solid ${isBoss ? 'rgba(233,196,0,0.4)' : 'rgba(0,253,236,0.3)'};">
                        ${isBoss ? '⚔ BOSS' : '🗡 NORMAL'}
                    </span>
                    <span style="font-size:0.6rem; color:var(--text-dim);">#${i+1}</span>
                </div>
                <button class="btn-nav" style="padding:4px 12px; font-size:0.55rem; color:var(--accent-red); border-color:var(--accent-red);" onclick="deleteMonster(${i})">삭제</button>
            </div>
            <div style="display:flex; gap:15px; align-items:flex-start;">
                <div style="flex-shrink:0; text-align:center;">
                    <img src="${m.img}" style="width:80px; height:80px; object-fit:contain; border-radius:12px; background:rgba(0,0,0,0.4); border:1px solid var(--glass-border);"
                        onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 80 80%22><text x=%2240%22 y=%2250%22 text-anchor=%22middle%22 font-size=%2240%22>👾</text></svg>'">
                    <label class="btn-nav" style="display:block; margin-top:8px; padding:5px 10px; font-size:0.5rem; cursor:pointer; text-align:center; border-color:var(--secondary-cyan); color:var(--secondary-cyan);">
                        이미지 변경
                        <input type="file" accept="image/*" style="display:none;" onchange="uploadMonsterImage(${i}, this)">
                    </label>
                </div>
                <div style="flex:1;">
                    <div style="margin-bottom:10px;">
                        <label style="font-size:0.55rem; color:var(--text-dim); display:block; margin-bottom:4px;">몬스터 이름</label>
                        <input type="text" class="set-m-name btn-nav" data-index="${i}" value="${m.name}" style="width:100%; font-size:0.8rem; padding:10px 12px;">
                    </div>
                    <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:8px;">
                        <div><label style="font-size:0.5rem; color:var(--text-dim);">HP</label>
                            <input type="number" class="set-m-hp btn-nav" data-index="${i}" value="${m.hp}" style="width:100%; font-size:0.75rem;"></div>
                        <div><label style="font-size:0.5rem; color:var(--text-dim);">ATK</label>
                            <input type="number" class="set-m-dmg btn-nav" data-index="${i}" value="${m.dmg}" style="width:100%; font-size:0.75rem;"></div>
                        <div><label style="font-size:0.5rem; color:var(--text-dim);">타입</label>
                            <select class="set-m-type btn-nav" data-index="${i}" style="width:100%; height:38px; font-size:0.7rem; color:#fff !important; background:rgba(17,19,31,0.8) !important;">
                                <option value="normal" style="color:#fff; background:#1a1c2e;" ${!isBoss ? 'selected' : ''}>🗡 일반</option>
                                <option value="boss" style="color:#e9c400; background:#1a1c2e;" ${isBoss ? 'selected' : ''}>⚔ 보스</option>
                            </select>
                        </div>
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
    pool.push({ name: type === 'boss' ? '새 보스 몬스터' : '새 일반 몬스터', hp: type === 'boss' ? 200 : 80, dmg: type === 'boss' ? 15 : 8, img: '', type });
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
    const hps = document.querySelectorAll('.set-m-hp');
    const dmgs = document.querySelectorAll('.set-m-dmg');
    const types = document.querySelectorAll('.set-m-type');
    const pool = await getMonsterPool();
    names.forEach((input, i) => { pool[i].name = input.value; pool[i].hp = parseInt(hps[i].value); pool[i].dmg = parseInt(dmgs[i].value); pool[i].type = types[i].value; });
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
            await db.from('portals').insert({ id: Date.now(), name, lat: e.latlng.lat, lng: e.latlng.lng, mission_text: "이 지역의 위협 요소를 제거하십시오.", radius: 100, spawn_chance: 1.0, spawn_distance_requirement: 20 });
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
                    <div style="font-size:0.5rem; color:var(--text-dim);">반경 ${p.radius || 100}m | 조사 거리 ${p.spawn_distance_requirement || 20}m</div>
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
    const data = {
        name: document.getElementById('ed-p-name').value,
        mission_text: document.getElementById('ed-p-mission').value,
        radius: parseInt(document.getElementById('ed-p-radius').value),
        spawn_distance_requirement: parseInt(document.getElementById('ed-p-walk').value),
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
    await db.from('player_state').update(stats).eq('id', 'singleton');
    alert("커맨더 데이터 동기화 완료.");
}
async function saveLootSettings() {
    const s = { chance: parseFloat(document.getElementById('set-l-chance').value), fixed: document.getElementById('set-l-fixed').checked };
    await db.from('game_settings').update({ value: s }).eq('name', 'lootSettings');
    alert("아이템 드랍 설정 저장 완료.");
}
