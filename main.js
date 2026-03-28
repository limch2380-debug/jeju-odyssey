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

// SUPABASE CONNECTION
const SUPABASE_URL = "https://icggdzxzifbhegvdwzdc.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImljZ2dkenh6aWZiaGVndmR3emRjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ2MzE2NTQsImV4cCI6MjA5MDIwNzY1NH0.ceUvWu-78qaIxJcq490LUCUcwHS4NVCMYzL3YGemWjs";
const db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// Global Settings with Defaults — type: "normal" | "boss"
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

// ===== SOUNDS — 칼 전투 사운드 =====
const SOUNDS = {
    hit: new Audio('https://assets.mixkit.co/active_storage/sfx/2788/2788-preview.mp3'),       // Sword slash hit
    enemyHit: new Audio('https://assets.mixkit.co/active_storage/sfx/2790/2790-preview.mp3'),  // Metal sword impact
    potion: new Audio('https://assets.mixkit.co/active_storage/sfx/1487/1487-preview.mp3'),    // Crystal heal
    victory: new Audio('https://assets.mixkit.co/active_storage/sfx/2019/2019-preview.mp3'),   // Victory Fanfare
    swordSwing: new Audio('https://assets.mixkit.co/active_storage/sfx/2786/2786-preview.mp3') // Sword swing whoosh
};

let combatState = { 
    playerHP: 100, 
    playerMaxHP: 100,
    potions: 1, 
    currentEnemy: null, 
    isGameOver: false, 
    isAuto: false 
};
let autoBattleInterval = null;
let cachedPlayerStats = null;
let cachedMonsterPool = null;

// Safe Initialization
async function initApp() {
    try {
        cachedMonsterPool = await getMonsterPool();
        cachedPlayerStats = await getPlayerSettings();
    } catch(e) { console.log("Init sequence data fetch warning:", e); }
    
    updateClock();
    await updateDashboardHUD();
}
initApp();

function showScreen(screenId) {
    activeScreen = screenId;
    const screens = document.querySelectorAll('.screen');
    screens.forEach(screen => screen.classList.remove('active'));
    const target = document.getElementById(`screen-${screenId}`);
    if (target) target.classList.add('active');

    if (screenId === 'dashboard') {
        setTimeout(() => {
            initMap(); startTracking(); loadPortals();
            if (map) { map.invalidateSize(); map.setView(currentUserPos, 17); }
        }, 100);
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
    const monsterPool = await getMonsterPool();
    
    portals.forEach(p => {
        const isBoss = p.target_monster_name && monsterPool.find(m => m.name === p.target_monster_name && m.type === 'boss');
        const portalColor = isBoss ? 'var(--accent-red)' : 'var(--secondary-cyan)';
        const portalIcon = L.divIcon({ 
            className: 'portal-marker', 
            html: `<div class="portal-node" style="background: ${portalColor}; box-shadow: 0 0 20px ${portalColor};"></div>`, 
            iconSize: [20, 20], iconAnchor: [10, 10] 
        });
        const marker = L.marker([p.lat, p.lng], { icon: portalIcon }).addTo(map)
            .on('click', () => { forcedPortalId = p.id; checkProximity(); alert(`${p.name} 위치 감지.`); });
        portalMarkers.push(marker);
    });
}

function startTracking() {
    if ("geolocation" in navigator) {
        watchId = navigator.geolocation.watchPosition((pos) => {
            const newPos = [pos.coords.latitude, pos.coords.longitude];
            
            const distMoved = L.latLng(lastWalkPos).distanceTo(newPos);
            if (distMoved > 2 && activeMissionPortalId) {
                walkAccumulator += distMoved;
                lastWalkPos = newPos;
            } else if (!activeMissionPortalId) {
                lastWalkPos = newPos;
            }

            currentUserPos = newPos;
            if (userMarker) userMarker.setLatLng(currentUserPos);
            if (accuracyCircle) { 
                accuracyCircle.setLatLng(currentUserPos); 
                accuracyCircle.setRadius(pos.coords.accuracy); 
            }
            if (map && activeScreen === 'dashboard') {
                map.panTo(currentUserPos);
            }
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

// ===== PROXIMITY / ENCOUNTER SYSTEM =====
let proximityRunning = false;

async function checkProximity() {
    if (activeScreen !== 'dashboard') return;
    if (encounterPending) return;
    if (proximityRunning) return;
    proximityRunning = true;
    
    try {
    const portals = await getPortals();
    let nearestDist = Infinity;
    let insidePortal = null;
    
    portals.forEach(p => {
        const dist = L.latLng(currentUserPos).distanceTo(L.latLng(p.lat, p.lng));
        if (dist < nearestDist) nearestDist = dist;
        if (dist < (p.radius || 100)) {
            insidePortal = p;
        } else {
            if (ignoredPortalIds.has(p.id) && dist > (p.radius || 100) * 1.5) {
                ignoredPortalIds.delete(p.id);
            }
            if (activeMissionPortalId === p.id && dist > (p.radius || 100)) {
                activeMissionPortalId = null;
                walkAccumulator = 0;
            }
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

            // ★ 게이지 100% → 인카운터 100% 발생
            if (walkAccumulator >= targetDist) {
                encounterPending = true;
                const monsterToSpawn = insidePortal.target_monster_name;
                
                console.log('[ENCOUNTER] 게이지 충족! 전투 전환. monster:', monsterToSpawn);
                
                document.getElementById('map-status').innerHTML = `<span style="color: var(--accent-red); animation: pulse 1s infinite; font-weight:bold;">[!] 적의 기습! 전투 화면으로 전환합니다...</span>`;
                missionOverlay.style.display = 'none';
                
                setTimeout(() => {
                    walkAccumulator = 0;
                    activeMissionPortalId = null;
                    encounterPending = false;
                    startCombat(monsterToSpawn);
                }, 1200);
                
                proximityRunning = false;
                return;
            }
        } else if (!ignoredPortalIds.has(insidePortal.id) && pendingConfirmationPortalId !== insidePortal.id) {
            pendingConfirmationPortalId = insidePortal.id;
            document.getElementById('confirm-portal-name').innerText = insidePortal.name;
            confirmModal.style.display = 'flex';
            missionOverlay.style.display = 'none';
        }
    } else {
        currentMissionPortal = null;
        pendingConfirmationPortalId = null;
        confirmModal.style.display = 'none';
        missionOverlay.style.display = 'none';
        document.getElementById('map-status').innerText = "시스템 온라인 // 신호 분석 중";
    }
    } finally {
        proximityRunning = false;
    }
}

function acceptMission() {
    if (currentMissionPortal) {
        activeMissionPortalId = currentMissionPortal.id;
        pendingConfirmationPortalId = null;
        walkAccumulator = 0;
        lastWalkPos = currentUserPos;
        document.getElementById('portal-confirm-modal').style.display = 'none';
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

// ===== COMBAT CONTROLLER =====
async function startCombat(forcedMonsterName = null) {
    const playerStats = await getPlayerSettings();
    const monsterPool = await getMonsterPool();
    
    let targetMonster;
    if (forcedMonsterName) {
        targetMonster = monsterPool.find(m => m.name === forcedMonsterName) || monsterPool[0];
    } else {
        // 강제 지정이 없으면 일반(normal) 몬스터 중에서 랜덤
        const normalMonsters = monsterPool.filter(m => m.type !== 'boss');
        const pool = normalMonsters.length > 0 ? normalMonsters : monsterPool;
        targetMonster = pool[Math.floor(Math.random() * pool.length)];
    }
    
    combatState = {
        playerHP: playerStats.hp,
        playerMaxHP: playerStats.hp,
        playerAtk: playerStats.atk,
        playerDef: playerStats.def,
        potions: playerStats.potions,
        currentEnemy: { 
            ...targetMonster, 
            hp: targetMonster.hp,
            maxHp: targetMonster.hp 
        },
        isGameOver: false,
        isAuto: false
    };

    document.getElementById('enemy-name-label').innerText = combatState.currentEnemy.name;
    
    // 이미지 소스 결정: URL이면 그대로, 아니면 로컬 파일
    const imgSrc = combatState.currentEnemy.img;
    document.getElementById('enemy-img-main').src = imgSrc;
    document.getElementById('enemy-img-main').style.opacity = "1";
    document.getElementById('btn-auto-battle').innerText = "AUTO_BATTLE: OFF";
    document.getElementById('btn-auto-battle').style.background = "var(--bg-space)";
    
    // 보스 여부에 따른 UI
    const isBoss = combatState.currentEnemy.type === 'boss';
    const nameLabel = document.getElementById('enemy-name-label');
    if (isBoss) {
        nameLabel.style.color = 'var(--primary-gold)';
        nameLabel.innerText = `⚔ ${combatState.currentEnemy.name} [BOSS]`;
    } else {
        nameLabel.style.color = 'var(--accent-red)';
    }
    
    stopAutoBattle();
    updateCombatUI();
    
    const entryMsg = isBoss ? '⚔ 강력한 보스가 나타났다! 전투 태세!' : '전장에 진입했습니다. TARGET_ACQUIRED!';
    document.getElementById('combat-log').innerHTML = `<div class="log-entry">${entryMsg}</div>`;
    
    playSound('swordSwing');
    showScreen('combat');
}

async function usePotion() {
    if (combatState.isGameOver || combatState.busy || combatState.potions <= 0) return;
    
    combatState.busy = true;
    updateActionButtons(false);

    const healAmount = Math.floor(combatState.playerMaxHP * 0.5);
    combatState.playerHP = Math.min(combatState.playerMaxHP, combatState.playerHP + healAmount);
    combatState.potions--;
    
    await db.from('player_state').update({ potions: combatState.potions }).eq('id', 'singleton');
    
    playSound('potion');
    renderLog(`나노봇 포션을 사용했습니다! HP +${healAmount}`, "player");
    updateCombatUI();
    
    setTimeout(() => {
        combatState.busy = false;
        executeEnemyTurn();
    }, 1000);
}

function updateActionButtons(enabled) {
    const attackBtn = document.getElementById('btn-attack');
    const potionBtn = document.getElementById('btn-potion');
    if (attackBtn) attackBtn.disabled = !enabled;
    if (potionBtn) potionBtn.disabled = !enabled || combatState.potions <= 0;
}

function playSound(name) {
    if (SOUNDS[name]) {
        SOUNDS[name].currentTime = 0;
        SOUNDS[name].play().catch(e => console.log("Sound play prevented: ", e));
    }
}

function triggerShake() {
    const scene = document.querySelector('.combat-scene');
    scene.classList.add('shake');
    setTimeout(() => scene.classList.remove('shake'), 400);
}

function executeEnemyTurn() {
    if (combatState.isGameOver) return;
    
    combatState.busy = true;
    updateActionButtons(false);
    
    const enemy = combatState.currentEnemy;
    let rawDMG = Math.floor(Math.random() * 5) + enemy.dmg;
    let reduction = Math.floor(rawDMG * (combatState.playerDef / 100));
    let eDmg = Math.max(1, rawDMG - reduction);
    
    combatState.playerHP = Math.max(0, combatState.playerHP - eDmg);
    
    triggerShake();
    playSound('enemyHit'); // 칼 타격음
    const scene = document.querySelector('.combat-scene');
    scene.classList.add('flash-red', 'glitch');
    setTimeout(() => scene.classList.remove('flash-red', 'glitch'), 300);

    renderLog(`${enemy.name}의 공격! ${eDmg} 대미지 발생.`, "enemy");
    
    if (combatState.playerHP <= 0) {
        renderLog("심각한 손상! 후퇴 시스템 가동.", "enemy");
        combatState.isGameOver = true;
        setTimeout(() => showScreen('main'), 2000);
        stopAutoBattle();
    } else {
        setTimeout(() => {
            combatState.busy = false;
            updateActionButtons(true);
        }, 500);
    }
    updateCombatUI();
}

function toggleAutoBattle() {
    combatState.isAuto = !combatState.isAuto;
    const btn = document.getElementById('btn-auto-battle');
    if (combatState.isAuto) {
        btn.innerText = "AUTO_BATTLE: ON";
        btn.style.background = "rgba(0, 253, 236, 0.2)";
        autoBattleInterval = setInterval(() => {
            if (!combatState.isGameOver) executePlayerTurn('slash');
            else stopAutoBattle();
        }, 1000);
    } else {
        stopAutoBattle();
    }
}

function stopAutoBattle() {
    combatState.isAuto = false;
    const btn = document.getElementById('btn-auto-battle');
    if (btn) {
        btn.innerText = "AUTO_BATTLE: OFF";
        btn.style.background = "var(--bg-space)";
    }
    if (autoBattleInterval) clearInterval(autoBattleInterval);
    autoBattleInterval = null;
}

function executePlayerTurn(action) {
    if (combatState.isGameOver || combatState.busy) return;
    
    combatState.busy = true;
    updateActionButtons(false);

    let enemy = combatState.currentEnemy;
    let dmg = Math.floor(Math.random() * 10) + combatState.playerAtk;
    
    enemy.hp = Math.max(0, enemy.hp - dmg);
    
    // 칼 전투 사운드
    playSound('swordSwing');
    setTimeout(() => playSound('hit'), 150); // 스윙 후 타격
    
    const enemyImg = document.getElementById('enemy-img-main');
    enemyImg.classList.add('shake');
    setTimeout(() => enemyImg.classList.remove('shake'), 400);

    renderLog(`검을 휘둘러 ${dmg}의 데미지를 입혔습니다!`, "player");
    updateCombatUI();

    if (enemy.hp <= 0) {
        handleVictory();
    } else {
        setTimeout(() => {
            combatState.busy = false;
            executeEnemyTurn();
        }, 1000);
    }
}

async function handleVictory() {
    playSound('victory');
    renderLog("전투 승리! 적 개체를 소탕했습니다.", "player");
    combatState.isGameOver = true;
    document.getElementById('enemy-img-main').style.opacity = "0";
    
    let stats = await getPlayerSettings();
    const xpGain = 30 + Math.floor(Math.random() * 20);
    stats.xp = (stats.xp || 0) + xpGain;
    renderLog(`전술 경험치 +${xpGain} 획득.`, "player");

    // Level Up
    const xpNeeded = (stats.level || 1) * 100;
    if (stats.xp >= xpNeeded) {
        stats.level++;
        stats.xp -= xpNeeded;
        stats.hp += 20; 
        stats.atk += 5;
        renderLog(`시스템 업그레이드! LEVEL ${stats.level} 달성!`, "player");
    }

    // ★ 보스 처치 시 정령카드 100% 드랍 (type === 'boss'로 판별)
    const isBoss = combatState.currentEnemy.type === 'boss';
    if (isBoss) {
        stats.spirit_cards = (stats.spirit_cards || 0) + 1;
        renderLog("★ 보스 처치! [정령 카드]를 100% 확률로 확보했습니다!", "player");
        playSound('victory');
    }

    // Potion Drop
    const settings = await getLootSettings();
    const isDrop = settings.fixed || Math.random() < settings.chance;
    if (isDrop) {
        stats.potions++;
        renderLog("나노봇 포션을 획득했습니다.", "player");
    }

    await db.from('player_state').update(stats).eq('id', 'singleton');
    updateDashboardHUD();

    setTimeout(() => {
        if (combatState.isGameOver) {
            showScreen('dashboard');
            stopAutoBattle();
        }
    }, 4000);
}

function updateCombatUI() {
    const enemy = combatState.currentEnemy;
    if (!enemy) return;

    const enemyHPBar = document.getElementById('enemy-hp-bar');
    if (enemyHPBar) {
        const enemyHPPercent = (enemy.hp / enemy.maxHp * 100);
        enemyHPBar.style.width = enemyHPPercent + "%";
    }
    
    const playerBar = document.getElementById('hud-hp-bar');
    const playerHPPercent = (combatState.playerHP / combatState.playerMaxHP * 100);
    if (playerBar) playerBar.style.width = playerHPPercent + "%";
    
    const hpText = document.getElementById('hud-hp-text');
    if (hpText) hpText.innerText = Math.round(playerHPPercent) + "%";
    
    const potionBtn = document.getElementById('btn-potion');
    if (potionBtn) {
        potionBtn.innerText = `HEAL (${combatState.potions})`;
        potionBtn.disabled = (combatState.potions <= 0);
    }

    const mainLevel = document.getElementById('main-level');
    if (mainLevel && cachedPlayerStats) mainLevel.innerText = cachedPlayerStats.level || 1;
}

function renderLog(msg, type) {
    const log = document.getElementById('combat-log');
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;
    entry.innerText = msg;
    log.prepend(entry);
}

function updateClock() {
    const timeDisplay = document.getElementById('system-time');
    if (timeDisplay) {
        const now = new Date();
        timeDisplay.innerText = now.toTimeString().split(' ')[0] + " // " + now.toLocaleDateString('ko-KR');
    }
}
setInterval(updateClock, 1000);
updateClock();
window.addEventListener('resize', () => { if (map) map.invalidateSize(); if (setMap) setMap.invalidateSize(); });

// ===== SETTINGS CONTROLLER (완전 리뉴얼) =====
let setMap;

async function initSettings() {
    // Player
    const pStats = await getPlayerSettings();
    document.getElementById('set-p-hp').value = pStats.hp;
    document.getElementById('set-p-atk').value = pStats.atk;
    document.getElementById('set-p-def').value = pStats.def;
    document.getElementById('set-p-pot').value = pStats.potions;

    // Loot
    const lStats = await getLootSettings();
    document.getElementById('set-l-chance').value = lStats.chance;
    document.getElementById('set-l-fixed').checked = lStats.fixed;

    renderSettingsMonsterList();
    initSettingsMap();
    renderSettingsPortalList();
}

// ===== MONSTER LIST — 이름 편집, 이미지 업로드, 타입(일반/보스) 구분 =====
async function renderSettingsMonsterList() {
    const pool = await getMonsterPool();
    const container = document.getElementById('set-monster-list');
    container.innerHTML = '';
    
    pool.forEach((m, i) => {
        const isBoss = m.type === 'boss';
        const item = document.createElement('div');
        item.className = 'glass-panel monster-card';
        item.style.marginBottom = '15px';
        item.style.padding = '20px';
        if (isBoss) {
            item.style.borderLeft = '4px solid var(--primary-gold)';
            item.style.boxShadow = '0 0 15px rgba(233, 196, 0, 0.1)';
        }
        
        item.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
                <div style="display: flex; align-items: center; gap: 10px;">
                    <span style="font-size: 0.6rem; padding: 3px 10px; border-radius: 20px; font-weight: 700; letter-spacing: 1px;
                        background: ${isBoss ? 'rgba(233,196,0,0.2)' : 'rgba(0,253,236,0.15)'}; 
                        color: ${isBoss ? 'var(--primary-gold)' : 'var(--secondary-cyan)'}; 
                        border: 1px solid ${isBoss ? 'rgba(233,196,0,0.4)' : 'rgba(0,253,236,0.3)'};">
                        ${isBoss ? '⚔ BOSS' : '🗡 NORMAL'}
                    </span>
                    <span style="font-size: 0.6rem; color: var(--text-dim);">#${i+1}</span>
                </div>
                <button class="btn-nav" style="padding: 4px 12px; font-size: 0.55rem; color: var(--accent-red); border-color: var(--accent-red);" 
                    onclick="deleteMonster(${i})">삭제</button>
            </div>
            
            <div style="display: flex; gap: 15px; align-items: flex-start;">
                <div style="flex-shrink: 0; text-align: center;">
                    <img src="${m.img}" style="width: 80px; height: 80px; object-fit: contain; border-radius: 12px; background: rgba(0,0,0,0.4); border: 1px solid var(--glass-border);"
                        onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 80 80%22><text x=%2240%22 y=%2250%22 text-anchor=%22middle%22 font-size=%2240%22>👾</text></svg>'">
                    <label class="btn-nav" style="display: block; margin-top: 8px; padding: 5px 10px; font-size: 0.5rem; cursor: pointer; text-align: center; border-color: var(--secondary-cyan); color: var(--secondary-cyan);">
                        이미지 변경
                        <input type="file" accept="image/*" style="display:none;" onchange="uploadMonsterImage(${i}, this)">
                    </label>
                </div>
                <div style="flex: 1;">
                    <div style="margin-bottom: 10px;">
                        <label style="font-size: 0.55rem; color: var(--text-dim); display: block; margin-bottom: 4px;">몬스터 이름</label>
                        <input type="text" class="set-m-name btn-nav" data-index="${i}" value="${m.name}" 
                            style="width: 100%; font-size: 0.8rem; padding: 10px 12px;">
                    </div>
                    <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px;">
                        <div>
                            <label style="font-size: 0.5rem; color: var(--text-dim);">HP</label>
                            <input type="number" class="set-m-hp btn-nav" data-index="${i}" value="${m.hp}" style="width: 100%; font-size: 0.75rem;">
                        </div>
                        <div>
                            <label style="font-size: 0.5rem; color: var(--text-dim);">ATK</label>
                            <input type="number" class="set-m-dmg btn-nav" data-index="${i}" value="${m.dmg}" style="width: 100%; font-size: 0.75rem;">
                        </div>
                        <div>
                            <label style="font-size: 0.5rem; color: var(--text-dim);">타입</label>
                            <select class="set-m-type btn-nav" data-index="${i}" style="width: 100%; height: 38px; font-size: 0.7rem; 
                                ${isBoss ? 'border-color: var(--primary-gold); color: var(--primary-gold);' : ''}">
                                <option value="normal" ${!isBoss ? 'selected' : ''}>일반</option>
                                <option value="boss" ${isBoss ? 'selected' : ''}>⚔ 보스</option>
                            </select>
                        </div>
                    </div>
                </div>
            </div>
        `;
        container.appendChild(item);
    });
}

// 이미지 업로드 → Supabase Storage
async function uploadMonsterImage(index, input) {
    const file = input.files[0];
    if (!file) return;
    
    const ext = file.name.split('.').pop();
    const fileName = `monster_${index}_${Date.now()}.${ext}`;
    
    // 업로드 진행 표시
    const card = input.closest('.monster-card');
    const img = card.querySelector('img');
    img.style.opacity = '0.3';
    
    try {
        const { data, error } = await db.storage.from('monster-images').upload(fileName, file, {
            cacheControl: '3600',
            upsert: true
        });
        
        if (error) {
            alert('이미지 업로드 실패: ' + error.message);
            img.style.opacity = '1';
            return;
        }
        
        // Public URL 가져오기
        const { data: urlData } = db.storage.from('monster-images').getPublicUrl(fileName);
        const publicUrl = urlData.publicUrl;
        
        // 몬스터 풀 업데이트
        const pool = await getMonsterPool();
        pool[index].img = publicUrl;
        await db.from('game_settings').update({ value: pool }).eq('name', 'monsterPool');
        
        img.src = publicUrl;
        img.style.opacity = '1';
        
        console.log('[UPLOAD] 몬스터 이미지 업로드 완료:', publicUrl);
    } catch(e) {
        alert('업로드 에러: ' + e.message);
        img.style.opacity = '1';
    }
}

// 몬스터 추가
async function addMonster(type) {
    const pool = await getMonsterPool();
    const newMonster = {
        name: type === 'boss' ? `새 보스 몬스터` : `새 일반 몬스터`,
        hp: type === 'boss' ? 200 : 80,
        dmg: type === 'boss' ? 15 : 8,
        img: '',
        type: type
    };
    pool.push(newMonster);
    await db.from('game_settings').update({ value: pool }).eq('name', 'monsterPool');
    renderSettingsMonsterList();
}

// 몬스터 삭제
async function deleteMonster(index) {
    if (!confirm('이 몬스터를 삭제하시겠습니까?')) return;
    const pool = await getMonsterPool();
    pool.splice(index, 1);
    await db.from('game_settings').update({ value: pool }).eq('name', 'monsterPool');
    renderSettingsMonsterList();
}

// 몬스터 풀 저장 (이름, HP, ATK, 타입 모두)
async function saveMonsterPool() {
    const names = document.querySelectorAll('.set-m-name');
    const hps = document.querySelectorAll('.set-m-hp');
    const dmgs = document.querySelectorAll('.set-m-dmg');
    const types = document.querySelectorAll('.set-m-type');
    const pool = await getMonsterPool();
    
    names.forEach((input, i) => {
        pool[i].name = input.value;
        pool[i].hp = parseInt(hps[i].value);
        pool[i].dmg = parseInt(dmgs[i].value);
        pool[i].type = types[i].value;
    });
    
    await db.from('game_settings').update({ value: pool }).eq('name', 'monsterPool');
    cachedMonsterPool = pool;
    alert("몬스터 데이터베이스 동기화 완료.");
    renderSettingsMonsterList();
}

// ===== PORTAL / MAP MANAGEMENT =====
function initSettingsMap() {
    if (setMap) return;
    setMap = L.map('set-map', { zoomControl: true }).setView(currentUserPos, 13);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png').addTo(setMap);
    setMap.on('click', async (e) => {
        const name = prompt("지역 이름을 입력하세요:", `탐사구역_${Math.floor(Math.random()*1000)}`);
        if (name) {
            await db.from('portals').insert({ 
                id: Date.now(), 
                name, 
                lat: e.latlng.lat, 
                lng: e.latlng.lng,
                mission_text: "이 지역의 위협 요소를 제거하십시오.",
                radius: 100,
                spawn_chance: 1.0,
                spawn_distance_requirement: 20
            });
            renderSettingsPortalList();
        }
    });
}

async function renderSettingsPortalList() {
    const portals = await getPortals();
    const monsterPool = await getMonsterPool();
    const container = document.getElementById('set-portal-list');
    container.innerHTML = '';
    
    setMap.eachLayer((layer) => { if (layer instanceof L.Marker) setMap.removeLayer(layer); });

    portals.forEach(p => {
        const assignedMonster = p.target_monster_name ? monsterPool.find(m => m.name === p.target_monster_name) : null;
        const isBoss = assignedMonster && assignedMonster.type === 'boss';
        const item = document.createElement('div');
        item.className = 'glass-panel';
        item.style.marginBottom = '10px';
        item.style.padding = '12px 15px';
        item.style.display = 'flex';
        item.style.justifyContent = 'space-between';
        item.style.alignItems = 'center';
        if (isBoss) {
            item.style.borderLeft = '4px solid var(--primary-gold)';
            item.style.background = 'rgba(233, 196, 0, 0.05)';
        }
        
        const monsterLabel = assignedMonster 
            ? `<span style="color:${isBoss ? 'var(--primary-gold)' : 'var(--secondary-cyan)'}; font-size:0.55rem;">
                ${isBoss ? '⚔' : '🗡'} ${assignedMonster.name}</span>` 
            : '<span style="color:var(--text-dim); font-size:0.55rem;">랜덤 일반 몬스터</span>';
        
        item.innerHTML = `
            <div style="flex: 1;">
                <div style="font-size: 0.75rem; color:${isBoss ? 'var(--primary-gold)' : '#fff'}; font-weight:${isBoss ? '700' : '400'}; margin-bottom: 3px;">
                    ${p.name} ${isBoss ? '<span style="font-size:0.6rem;">[BOSS ZONE]</span>' : ''}
                </div>
                <div style="font-size: 0.55rem; color:var(--text-dim); margin-bottom: 2px;">${p.mission_text?.substring(0,30) || ''}...</div>
                <div style="display: flex; gap: 10px; align-items: center;">
                    ${monsterLabel}
                    <span style="font-size:0.5rem; color:var(--text-dim);">반경 ${p.radius || 100}m | 거리 ${p.spawn_distance_requirement || 20}m</span>
                </div>
            </div>
            <div style="display:flex; gap:8px; flex-shrink:0;">
                <button class="btn-nav" style="padding: 5px 10px; font-size: 0.6rem; border-color: var(--secondary-cyan);" onclick="openPortalEditor(${p.id})">EDIT</button>
                <button class="btn-nav" style="padding: 5px 10px; font-size: 0.6rem; color: var(--accent-red); border-color: var(--accent-red);" onclick="deletePortalInSettings(${p.id})">DEL</button>
            </div>
        `;
        container.appendChild(item);
        
        // 맵 마커 — 보스 포탈은 빨간색
        const markerColor = isBoss ? '#ff4d4d' : '#00fdec';
        const markerIcon = L.divIcon({ 
            className: 'portal-marker',
            html: `<div style="width:14px;height:14px;background:${markerColor};border-radius:50%;box-shadow:0 0 10px ${markerColor};border:2px solid rgba(255,255,255,0.3);"></div>`,
            iconSize: [14, 14], iconAnchor: [7, 7]
        });
        L.marker([p.lat, p.lng], { icon: markerIcon }).addTo(setMap).bindPopup(`<b>${p.name}</b><br>${isBoss ? '⚔ BOSS ZONE' : '일반 구역'}`);
    });
}

// Portal Editor Logic
let editingPortalId = null;
async function openPortalEditor(id) {
    editingPortalId = id;
    const portals = await getPortals();
    const p = portals.find(x => x.id == id);
    const monsters = await getMonsterPool();
    
    document.getElementById('ed-p-name').value = p.name;
    document.getElementById('ed-p-mission').value = p.mission_text || "";
    document.getElementById('ed-p-radius').value = p.radius || 100;
    document.getElementById('ed-p-walk').value = p.spawn_distance_requirement || 20;
    
    // 몬스터 선택 — 일반/보스 구분 표시
    const select = document.getElementById('ed-p-monster');
    select.innerHTML = '<option value="">랜덤 일반 몬스터</option>';
    
    const normalMonsters = monsters.filter(m => m.type !== 'boss');
    const bossMonsters = monsters.filter(m => m.type === 'boss');
    
    if (normalMonsters.length > 0) {
        const normalGroup = document.createElement('optgroup');
        normalGroup.label = '🗡 일반 몬스터';
        normalMonsters.forEach(m => {
            const opt = document.createElement('option');
            opt.value = m.name;
            opt.innerText = m.name;
            if (p.target_monster_name === m.name) opt.selected = true;
            normalGroup.appendChild(opt);
        });
        select.appendChild(normalGroup);
    }
    
    if (bossMonsters.length > 0) {
        const bossGroup = document.createElement('optgroup');
        bossGroup.label = '⚔ 보스 몬스터';
        bossMonsters.forEach(m => {
            const opt = document.createElement('option');
            opt.value = m.name;
            opt.innerText = `⚔ ${m.name}`;
            if (p.target_monster_name === m.name) opt.selected = true;
            bossGroup.appendChild(opt);
        });
        select.appendChild(bossGroup);
    }
    
    document.getElementById('portal-editor-modal').style.display = 'block';
}

function closePortalEditor() {
    document.getElementById('portal-editor-modal').style.display = 'none';
}

async function applyPortalEdit() {
    const data = {
        name: document.getElementById('ed-p-name').value,
        mission_text: document.getElementById('ed-p-mission').value,
        radius: parseInt(document.getElementById('ed-p-radius').value),
        spawn_distance_requirement: parseInt(document.getElementById('ed-p-walk').value),
        target_monster_name: document.getElementById('ed-p-monster').value || null
    };
    await db.from('portals').update(data).eq('id', editingPortalId);
    closePortalEditor();
    renderSettingsPortalList();
}

async function deletePortalInSettings(id) {
    if (confirm("이 포탈을 삭제하시겠습니까?")) {
        await db.from('portals').delete().eq('id', id);
        renderSettingsPortalList();
    }
}

async function savePlayerSettings() {
    const stats = {
        hp: parseInt(document.getElementById('set-p-hp').value),
        atk: parseInt(document.getElementById('set-p-atk').value),
        def: parseInt(document.getElementById('set-p-def').value),
        potions: parseInt(document.getElementById('set-p-pot').value)
    };
    await db.from('player_state').update(stats).eq('id', 'singleton');
    alert("커맨더 데이터 동기화 완료.");
}

async function saveLootSettings() {
    const stats = {
        chance: parseFloat(document.getElementById('set-l-chance').value),
        fixed: document.getElementById('set-l-fixed').checked
    };
    await db.from('game_settings').update({ value: stats }).eq('name', 'lootSettings');
    alert("아이템 드랍 설정 동기화 완료.");
}
