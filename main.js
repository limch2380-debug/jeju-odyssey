let map;
let userMarker, accuracyCircle;
let portalMarkers = [];
let watchId, isFirstFix = true;
let currentUserPos = [33.4890, 126.4908];
let forcedPortalId = null;

// SUPABASE CONNECTION
const SUPABASE_URL = "https://icggdzxzifbhegvdwzdc.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImljZ2dkenh6aWZiaGVndmR3emRjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ2MzE2NTQsImV4cCI6MjA5MDIwNzY1NH0.ceUvWu-78qaIxJcq490LUCUcwHS4NVCMYzL3YGemWjs";
const db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// Global Settings with Defaults
const DEFAULT_MONSTERS = [
    { name: "고블린 병사 (SOLDIER)", hp: 100, dmg: 8, img: "goblin_soldier_tactical.png" },
    { name: "고블린 궁수 (ARCHER)", hp: 70, dmg: 12, img: "goblin_archer_cloak.png" },
    { name: "대왕 고블린 (BOSS)", hp: 250, dmg: 18, img: "great_goblin_boss.png" }
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

const SOUNDS = {
    hit: new Audio('https://assets.mixkit.co/active_storage/sfx/2785/2785-preview.mp3'), // Sharp Metal Hit
    enemyHit: new Audio('https://assets.mixkit.co/active_storage/sfx/2568/2568-preview.mp3'), // Fast Slash
    potion: new Audio('https://assets.mixkit.co/active_storage/sfx/1487/1487-preview.mp3'), // Crystal heal
    victory: new Audio('https://assets.mixkit.co/active_storage/sfx/2019/2019-preview.mp3') // Victory Fanfare
};

// Combat Assets
const monsterPool = [
    { name: "고블린 병사 (SOLDIER)", hp: 100, dmg: 8, img: "goblin_soldier_tactical.png" },
    { name: "고블린 궁수 (ARCHER)", hp: 70, dmg: 12, img: "goblin_archer_cloak.png" },
    { name: "대왕 고블린 (BOSS)", hp: 250, dmg: 18, img: "great_goblin_boss.png" }
];

let combatState = { 
    playerHP: 100, 
    playerMaxHP: 100,
    potions: parseInt(localStorage.getItem('potions') || '1'),
    currentEnemy: null, 
    isGameOver: false, 
    isAuto: false 
};
let autoBattleInterval = null;

function showScreen(screenId) {
    const screens = document.querySelectorAll('.screen');
    screens.forEach(screen => screen.classList.remove('active'));
    const target = document.getElementById(`screen-${screenId}`);
    if (target) target.classList.add('active');

    if (screenId === 'dashboard') {
        setTimeout(() => {
            initMap(); startTracking(); loadPortals();
            if (map) map.invalidateSize();
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
    const portals = await getPortals();
    portals.forEach(p => {
        const portalIcon = L.divIcon({ className: 'portal-marker', html: '<div class="portal-node"></div>', iconSize: [20, 20], iconAnchor: [10, 10] });
        const marker = L.marker([p.lat, p.lng], { icon: portalIcon }).addTo(map).on('click', () => { forcedPortalId = p.id; checkProximity(); alert(`${p.name} 위치 감지.`); });
        portalMarkers.push(marker);
    });
}

function startTracking() {
    if ("geolocation" in navigator) {
        watchId = navigator.geolocation.watchPosition((pos) => {
            currentUserPos = [pos.coords.latitude, pos.coords.longitude];
            if (userMarker) userMarker.setLatLng(currentUserPos);
            if (accuracyCircle) { accuracyCircle.setLatLng(currentUserPos); accuracyCircle.setRadius(pos.coords.accuracy); }
            if (isFirstFix) { map.setView(currentUserPos, 16); isFirstFix = false; }
            checkProximity();
        }, () => {}, { enableHighAccuracy: true });
    }
}

async function checkProximity() {
    const portals = await getPortals();
    let nearest = Infinity; let nearP = null;
    portals.forEach(p => {
        const dist = L.latLng(currentUserPos).distanceTo(L.latLng(p.lat, p.lng));
        if (dist < nearest) nearest = dist;
        if (dist < 100 || p.id === forcedPortalId) nearP = p;
    });
    const btn = document.getElementById('btn-enter-portal');
    const dist = document.getElementById('distance-info');
    if (btn) btn.style.display = nearP ? 'block' : 'none';
    if (dist) dist.innerText = (nearest === Infinity) ? "NEARBY: NO_PORTALS" : `NEARBY: ${Math.round(nearest)}m TO_RIFT`;
}

function stopTracking() { if (watchId) navigator.geolocation.clearWatch(watchId); }

// Combat Controller
async function startCombat() {
    const playerStats = await getPlayerSettings();
    const monsterPool = await getMonsterPool();
    const randomMonster = monsterPool[Math.floor(Math.random() * monsterPool.length)];
    
    combatState = {
        playerHP: playerStats.hp,
        playerMaxHP: playerStats.hp,
        playerAtk: playerStats.atk,
        playerDef: playerStats.def,
        potions: playerStats.potions,
        currentEnemy: { 
            ...randomMonster, 
            hp: randomMonster.hp,
            maxHp: randomMonster.hp 
        },
        isGameOver: false,
        isAuto: false
    };

    document.getElementById('enemy-name-label').innerText = combatState.currentEnemy.name;
    document.getElementById('enemy-img-main').src = combatState.currentEnemy.img;
    document.getElementById('enemy-img-main').style.opacity = "1";
    document.getElementById('btn-auto-battle').innerText = "AUTO_BATTLE: OFF";
    document.getElementById('btn-auto-battle').style.background = "var(--bg-space)";
    
    stopAutoBattle();
    updateCombatUI();
    document.getElementById('combat-log').innerHTML = '<div class="log-entry">전장에 진입했습니다. TARGET_ACQUIRED!</div>';
    showScreen('combat');
}

async function usePotion() {
    if (combatState.isGameOver || combatState.busy || combatState.potions <= 0) return;
    
    combatState.busy = true;
    updateActionButtons(false);

    const healAmount = Math.floor(combatState.playerMaxHP * 0.5);
    combatState.playerHP = Math.min(combatState.playerMaxHP, combatState.playerHP + healAmount);
    combatState.potions--;
    
    // SAVE TO SUPABASE
    await db.from('player_state').update({ potions: combatState.potions }).eq('id', 'singleton');
    
    playSound('potion');
    renderLog(`나노봇 포션을 사용했습니다! HP +${healAmount}`, "player");
    updateCombatUI();
    
    // Enemy counter after potion use
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
    // Calculate damage with player defense
    let rawDMG = Math.floor(Math.random() * 5) + enemy.dmg;
    let reduction = Math.floor(rawDMG * (combatState.playerDef / 100));
    let eDmg = Math.max(1, rawDMG - reduction);
    
    combatState.playerHP = Math.max(0, combatState.playerHP - eDmg);
    
    // Effect
    triggerShake();
    playSound('enemyHit');
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
    // Base damage from settings
    let dmg = Math.floor(Math.random() * 10) + combatState.playerAtk;
    
    enemy.hp = Math.max(0, enemy.hp - dmg);
    
    // Effect
    playSound('hit');
    // enemy img shake or flash
    const enemyImg = document.getElementById('enemy-img-main');
    enemyImg.classList.add('shake');
    setTimeout(() => enemyImg.classList.remove('shake'), 400);

    renderLog(`적에게 ${dmg}의 데미지를 입혔습니다!`, "player");
    updateCombatUI();

    if (enemy.hp <= 0) {
        handleVictory();
    } else {
        setTimeout(() => {
            combatState.busy = false;
            executeEnemyTurn();
        }, 1000); // 1초 간격으로 공방
    }
}

async function handleVictory() {
    playSound('victory');
    renderLog("TARGET_DESTROYED! 전투에서 승리했습니다.", "player");
    combatState.isGameOver = true;
    document.getElementById('enemy-img-main').style.opacity = "0";
    
    // Drop Logic
    const settings = await getLootSettings();
    const isDrop = settings.fixed || Math.random() < settings.chance;
    
    if (isDrop) {
        combatState.potions++;
        await db.from('player_state').update({ potions: combatState.potions }).eq('id', 'singleton');
        renderLog("몬스터가 나노봇 포션을 드랍했습니다! [획득]", "player");
    }

    setTimeout(() => {
        showScreen('dashboard');
        stopAutoBattle();
    }, 2000);
}

function updateCombatUI() {
    const enemy = combatState.currentEnemy;
    const enemyHPPercent = (enemy.hp / enemy.maxHp * 100);
    document.getElementById('enemy-hp-bar').style.width = enemyHPPercent + "%";
    
    const playerHPPercent = (combatState.playerHP / combatState.playerMaxHP * 100);
    const playerBar = document.getElementById('player-hp-bar');
    if (playerBar) playerBar.style.width = playerHPPercent + "%";
    
    document.getElementById('player-hp-text').innerText = Math.round(playerHPPercent) + "%";
    
    const potionBtn = document.getElementById('btn-potion');
    if (potionBtn) {
        potionBtn.innerText = `HEAL (${combatState.potions})`;
        potionBtn.disabled = combatState.potions <= 0;
    }
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

// Settings Controller (Merged Admin)
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

async function renderSettingsMonsterList() {
    const pool = await getMonsterPool();
    const container = document.getElementById('set-monster-list');
    container.innerHTML = '';
    pool.forEach((m, i) => {
        const item = document.createElement('div');
        item.className = 'glass-panel';
        item.style.marginBottom = '10px';
        item.style.padding = '15px';
        item.innerHTML = `
            <div style="font-size: 0.7rem; color: var(--accent-red); margin-bottom: 10px;">THREAT #${i+1}: ${m.name}</div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
                <input type="number" class="set-m-hp" data-index="${i}" value="${m.hp}" placeholder="HP">
                <input type="number" class="set-m-dmg" data-index="${i}" value="${m.dmg}" placeholder="ATK">
            </div>
        `;
        container.appendChild(item);
    });
}

function initSettingsMap() {
    if (setMap) return;
    setMap = L.map('set-map', { zoomControl: true }).setView(currentUserPos, 13);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png').addTo(setMap);
    setMap.on('click', async (e) => {
        const name = prompt("포탈 이름을 입력하세요:", `균열_${Math.floor(Math.random()*1000)}`);
        if (name) {
            await db.from('portals').insert({ id: Date.now(), name, lat: e.latlng.lat, lng: e.latlng.lng });
            renderSettingsPortalList();
        }
    });
}

async function renderSettingsPortalList() {
    const portals = await getPortals();
    const container = document.getElementById('set-portal-list');
    container.innerHTML = '';
    
    // Clear map markers
    setMap.eachLayer((layer) => { if (layer instanceof L.Marker) setMap.removeLayer(layer); });

    portals.forEach(p => {
        const item = document.createElement('div');
        item.className = 'glass-panel';
        item.style.marginBottom = '10px';
        item.style.padding = '10px 15px';
        item.style.flexDirection = 'row';
        item.style.justifyContent = 'space-between';
        item.innerHTML = `
            <div style="font-size: 0.75rem;">${p.name}</div>
            <button class="btn-nav" style="padding: 5px 10px; font-size: 0.6rem; color: var(--accent-red); border-color: var(--accent-red);" onclick="deletePortalInSettings(${p.id})">DELETE</button>
        `;
        container.appendChild(item);
        L.marker([p.lat, p.lng]).addTo(setMap).bindPopup(p.name);
    });
}

async function deletePortalInSettings(id) {
    if (confirm("균열을 봉인하시겠습니까?")) {
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
    alert("COMMANDER_CORE_DATA SYNCED.");
}

async function saveMonsterPool() {
    const hps = document.querySelectorAll('.set-m-hp');
    const dmgs = document.querySelectorAll('.set-m-dmg');
    const pool = await getMonsterPool();
    hps.forEach((input, i) => {
        pool[i].hp = parseInt(input.value);
        pool[i].dmg = parseInt(dmgs[i].value);
    });
    await db.from('game_settings').update({ value: pool }).eq('name', 'monsterPool');
    alert("BIOLOGICAL_DATABASE UPDATED.");
}

async function saveLootSettings() {
    const stats = {
        chance: parseFloat(document.getElementById('set-l-chance').value),
        fixed: document.getElementById('set-l-fixed').checked
    };
    await db.from('game_settings').update({ value: stats }).eq('name', 'lootSettings');
    alert("LOOT_PROTOCOL SYNCED.");
}
