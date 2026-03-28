// ===== 카드 시스템 =====
const DEFAULT_CARD_TEMPLATES = [
    { templateId:'goblin_soldier', name:'고블린 병사', hp:100, atk:20, def:10, img:'goblin_card.png', skill:'double_attack', skillChance:20, skillEnabled:true, rarity:'common', type:'normal' },
    { templateId:'goblin_archer', name:'고블린 궁수', hp:70, atk:25, def:5, img:'goblin_card.png', skill:'dodge', skillChance:25, skillEnabled:true, rarity:'common', type:'normal' },
    { templateId:'great_goblin', name:'대왕 고블린', hp:250, atk:35, def:20, img:'boss_goblin_card.png', skill:'magic_attack', skillChance:30, skillEnabled:true, rarity:'rare', type:'boss' }
];
const SKILLS = {
    double_attack: { name:'이중 어택', desc:'2회 연속 공격', icon:'⚔' },
    magic_attack: { name:'마법 공격', desc:'방어 무시 공격', icon:'🔮' },
    dodge: { name:'회피', desc:'적 공격 회피', icon:'💨' }
};
const LEVEL_XP = [0,50,120,220,350,520,740,1000,1350,1800];

let selectedCardIdx = -1;
let fusionSelections = new Set();

async function getCardTemplates() {
    const {data} = await db.from('game_settings').select('value').eq('name','cardTemplates').single();
    return data ? data.value : DEFAULT_CARD_TEMPLATES;
}
async function getDropSettings() {
    const {data} = await db.from('game_settings').select('value').eq('name','dropSettings').single();
    return data ? data.value : { cardDrop:30, potionDrop:30, bossCardDrop:100 };
}
async function getInventory() {
    const {data} = await db.from('player_state').select('*').eq('id','singleton').single();
    return data?.inventory || [];
}
async function saveInventory(inv) {
    await db.from('player_state').update({inventory:inv}).eq('id','singleton');
}
async function getSelectedIdx() {
    const {data} = await db.from('player_state').select('selected_card').eq('id','singleton').single();
    return data?.selected_card ?? -1;
}
async function setSelectedIdx(idx) {
    selectedCardIdx = idx;
    await db.from('player_state').update({selected_card:idx}).eq('id','singleton');
}

function cardXpForLevel(lv) { return LEVEL_XP[Math.min(lv, LEVEL_XP.length-1)] || lv*200; }
function cardStatBonus(lv) { return { hp:(lv-1)*15, atk:(lv-1)*3, def:(lv-1)*2 }; }
function getCardEffective(card) {
    const b = cardStatBonus(card.level||1);
    return { ...card, hp:card.hp+b.hp, atk:card.atk+b.atk, def:card.def+b.def };
}
function rarityLabel(r) { return r==='rare'?'★희귀':r==='legendary'?'★★전설':'일반'; }
function rarityColor(r) { return r==='rare'?'var(--primary-gold)':r==='legendary'?'#ff44ff':'var(--secondary-cyan)'; }

// 인벤토리에 카드 추가 (최대10)
async function addCardToInventory(templateId) {
    const inv = await getInventory();
    if (inv.length >= 10) return false;
    const templates = await getCardTemplates();
    const t = templates.find(x=>x.templateId===templateId);
    if (!t) return false;
    inv.push({ id:Date.now(), templateId:t.templateId, name:t.name, hp:t.hp, atk:t.atk, def:t.def, img:t.img, skill:t.skill, skillChance:t.skillChance, skillEnabled:t.skillEnabled!==false, rarity:t.rarity, type:t.type, level:1, xp:0 });
    await saveInventory(inv);
    return true;
}

async function deleteCard(cardId) {
    let inv = await getInventory();
    const idx = inv.findIndex(c=>c.id===cardId);
    if (idx===-1) return;
    if (selectedCardIdx === idx) { selectedCardIdx=-1; await setSelectedIdx(-1); }
    else if (selectedCardIdx > idx) { selectedCardIdx--; await setSelectedIdx(selectedCardIdx); }
    inv.splice(idx,1);
    await saveInventory(inv);
}

async function selectCard(idx) {
    await setSelectedIdx(idx);
    updateSelectedCardDisplay();
}

async function updateSelectedCardDisplay() {
    const inv = await getInventory();
    selectedCardIdx = await getSelectedIdx();
    const el = document.getElementById('selected-card-preview');
    if (!el) return;
    if (selectedCardIdx >= 0 && selectedCardIdx < inv.length) {
        const c = inv[selectedCardIdx];
        const e = getCardEffective(c);
        el.innerHTML = `<div style="display:flex;align-items:center;gap:12px;justify-content:center;">
            <img src="${c.img}" style="width:40px;height:50px;object-fit:cover;border-radius:6px;border:2px solid ${rarityColor(c.rarity)};" onerror="this.src='goblin_card.png'">
            <div style="text-align:left;"><div style="font-size:0.75rem;color:${rarityColor(c.rarity)};font-weight:700;">${c.name} Lv.${c.level||1}</div>
            <div style="font-size:0.5rem;color:var(--text-dim);">HP:${e.hp} ATK:${e.atk} DEF:${e.def} | ${SKILLS[c.skill]?.icon||''} ${SKILLS[c.skill]?.name||''}</div></div></div>`;
    } else {
        el.innerHTML = `<div style="color:var(--accent-red);font-size:0.7rem;">⚠ 카드를 선택해주세요</div>`;
    }
}

function tryStartAdventure() {
    if (selectedCardIdx < 0) {
        alert('전투에 사용할 카드를 먼저 선택해주세요!\n인벤토리에서 카드를 선택하세요.'); return;
    }
    showScreen('dashboard');
}

// ===== 인벤토리 UI =====
async function renderInventory() {
    const inv = await getInventory();
    selectedCardIdx = await getSelectedIdx();
    document.getElementById('inv-count').innerText = `${inv.length} / 10`;
    const grid = document.getElementById('inventory-grid');
    grid.innerHTML = '';
    fusionSelections.clear();
    document.getElementById('fusion-selection').innerHTML = '';
    inv.forEach((c,i) => {
        const e = getCardEffective(c);
        const sel = i===selectedCardIdx;
        const div = document.createElement('div');
        div.className = 'glass-panel';
        div.style.cssText = `padding:12px;text-align:center;border-color:${sel?'var(--primary-gold)':rarityColor(c.rarity)};${sel?'background:rgba(233,196,0,0.08);box-shadow:0 0 15px rgba(233,196,0,0.15);':''}cursor:pointer;position:relative;`;
        const xpNext = cardXpForLevel(c.level||1);
        const xpPct = Math.min(100, ((c.xp||0)/xpNext)*100);
        div.innerHTML = `${sel?'<div style="position:absolute;top:6px;right:8px;font-size:0.45rem;color:var(--primary-gold);font-weight:700;">전투중</div>':''}
            <img src="${c.img}" style="width:60px;height:75px;object-fit:cover;border-radius:6px;border:2px solid ${rarityColor(c.rarity)};margin-bottom:6px;" onerror="this.src='goblin_card.png'">
            <div style="font-size:0.65rem;color:${rarityColor(c.rarity)};font-weight:700;">${c.name}</div>
            <div style="font-size:0.45rem;color:var(--text-dim);">Lv.${c.level||1} | ${rarityLabel(c.rarity)}</div>
            <div style="font-size:0.4rem;color:var(--text-dim);margin-top:4px;">HP:${e.hp} ATK:${e.atk} DEF:${e.def}</div>
            <div style="font-size:0.4rem;color:var(--secondary-cyan);">${c.skillEnabled!==false ? (SKILLS[c.skill]?.icon||'')+' '+(SKILLS[c.skill]?.name||'')+' '+c.skillChance+'%' : '<span style="color:var(--text-dim);">기술 OFF</span>'}</div>
            <div style="height:3px;background:rgba(255,255,255,0.05);border-radius:2px;margin-top:4px;"><div style="width:${xpPct}%;height:100%;background:var(--secondary-cyan);border-radius:2px;"></div></div>
            <div style="font-size:0.35rem;color:var(--text-dim);">XP: ${c.xp||0}/${xpNext}</div>
            <div style="display:flex;gap:4px;margin-top:8px;">
                <button class="btn-primary" style="flex:1;padding:6px;font-size:0.5rem;" onclick="event.stopPropagation();selectCard(${i})">전투</button>
                <button class="btn-nav" style="flex:1;padding:6px;font-size:0.5rem;text-align:center;" onclick="event.stopPropagation();toggleFusion(${i})">합성</button>
                <button class="btn-nav" style="padding:6px 8px;font-size:0.5rem;color:var(--accent-red);border-color:var(--accent-red);text-align:center;" onclick="event.stopPropagation();confirmDeleteCard(${c.id})">✕</button>
            </div>`;
        grid.appendChild(div);
    });
}
async function confirmDeleteCard(cardId) {
    if (!confirm('이 카드를 삭제하시겠습니까?')) return;
    await deleteCard(cardId);
    renderInventory(); updateSelectedCardDisplay();
}
function toggleFusion(idx) {
    if (fusionSelections.has(idx)) fusionSelections.delete(idx); else if (fusionSelections.size<2) fusionSelections.add(idx);
    const el = document.getElementById('fusion-selection');
    el.innerHTML = Array.from(fusionSelections).map(i=>`<span style="font-size:0.5rem;padding:4px 10px;border-radius:8px;background:rgba(233,196,0,0.1);color:var(--primary-gold);border:1px solid rgba(233,196,0,0.2);">슬롯${i+1}</span>`).join('');
}
async function fuseCards() {
    if (fusionSelections.size!==2) { alert('카드 2장을 선택하세요.'); return; }
    const inv = await getInventory();
    const [a,b] = Array.from(fusionSelections);
    if (!inv[a]||!inv[b]) return;
    if (inv[a].templateId !== inv[b].templateId) { alert('같은 종류의 카드만 합성 가능합니다.'); return; }
    const xpGain = 30 + (inv[b].level||1)*15;
    inv[a].xp = (inv[a].xp||0) + xpGain;
    const needXp = cardXpForLevel(inv[a].level||1);
    if (inv[a].xp >= needXp) { inv[a].level = (inv[a].level||1)+1; inv[a].xp -= needXp; alert(`${inv[a].name} Lv.${inv[a].level} 달성!`); }
    else { alert(`경험치 +${xpGain} 획득!`); }
    // 두번째 카드 삭제
    const removeIdx = b > a ? b : b;
    inv.splice(removeIdx, 1);
    if (selectedCardIdx === removeIdx) { selectedCardIdx=-1; await setSelectedIdx(-1); }
    else if (selectedCardIdx > removeIdx) { selectedCardIdx--; await setSelectedIdx(selectedCardIdx); }
    await saveInventory(inv);
    fusionSelections.clear();
    renderInventory(); updateSelectedCardDisplay();
}

// ===== 도감 UI =====
async function renderCollection() {
    const templates = await getCardTemplates();
    const inv = await getInventory();
    const grid = document.getElementById('collection-grid');
    grid.innerHTML = '';
    templates.forEach(t => {
        const owned = inv.filter(c=>c.templateId===t.templateId);
        const has = owned.length>0;
        const best = has ? owned.reduce((a,b)=>(a.level||1)>(b.level||1)?a:b) : null;
        const div = document.createElement('div');
        div.className = 'glass-panel';
        div.style.cssText = `padding:14px;text-align:center;${has?'':'opacity:0.4;'}border-color:${rarityColor(t.rarity)};`;
        div.innerHTML = `<img src="${t.img}" style="width:70px;height:88px;object-fit:cover;border-radius:8px;border:2px solid ${rarityColor(t.rarity)};margin-bottom:8px;${has?'':'filter:grayscale(1);'}" onerror="this.src='goblin_card.png'">
            <div style="font-size:0.7rem;color:${rarityColor(t.rarity)};font-weight:700;">${t.name}</div>
            <div style="font-size:0.45rem;color:var(--text-dim);">${rarityLabel(t.rarity)} | ${SKILLS[t.skill]?.name||'없음'}</div>
            <div style="font-size:0.4rem;color:var(--text-dim);margin-top:4px;">HP:${t.hp} ATK:${t.atk} DEF:${t.def}</div>
            ${has?`<div style="font-size:0.45rem;color:var(--primary-gold);margin-top:6px;">보유 ${owned.length}장 | 최고 Lv.${best.level||1}</div>`:'<div style="font-size:0.45rem;color:var(--text-dim);margin-top:6px;">미발견</div>'}`;
        grid.appendChild(div);
    });
}

// ===== 카드 에디터 UI =====
async function renderCardEditor() {
    const templates = await getCardTemplates();
    const el = document.getElementById('card-editor-list');
    el.innerHTML = '';
    templates.forEach((t,i) => {
        el.innerHTML += `<div class="glass-panel" style="margin-bottom:10px;padding:14px;border-color:${rarityColor(t.rarity)};">
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
                <img src="${t.img}" style="width:40px;height:50px;object-fit:cover;border-radius:6px;" onerror="this.src='goblin_card.png'">
                <div style="flex:1;"><input class="ce-name btn-nav" style="width:100%;padding:8px;font-size:0.7rem;" value="${t.name}" data-i="${i}"></div>
                <span style="font-size:0.5rem;color:${rarityColor(t.rarity)};">${rarityLabel(t.rarity)}</span>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:8px;">
                <div><label style="font-size:0.45rem;color:var(--text-dim);">HP</label><input type="number" class="ce-hp btn-nav" style="width:100%;padding:6px;" value="${t.hp}" data-i="${i}"></div>
                <div><label style="font-size:0.45rem;color:var(--text-dim);">ATK</label><input type="number" class="ce-atk btn-nav" style="width:100%;padding:6px;" value="${t.atk}" data-i="${i}"></div>
                <div><label style="font-size:0.45rem;color:var(--text-dim);">DEF</label><input type="number" class="ce-def btn-nav" style="width:100%;padding:6px;" value="${t.def}" data-i="${i}"></div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;">
                <div><label style="font-size:0.45rem;color:var(--text-dim);">고유기술</label>
                    <select class="ce-skill btn-nav" style="width:100%;padding:6px;" data-i="${i}">
                        <option value="double_attack" ${t.skill==='double_attack'?'selected':''}>⚔ 이중어택</option>
                        <option value="magic_attack" ${t.skill==='magic_attack'?'selected':''}>🔮 마법공격</option>
                        <option value="dodge" ${t.skill==='dodge'?'selected':''}>💨 회피</option>
                    </select></div>
                <div><label style="font-size:0.45rem;color:var(--text-dim);">기술확률%</label><input type="number" class="ce-schance btn-nav" style="width:100%;padding:6px;" value="${t.skillChance}" data-i="${i}" min="1" max="100"></div>
                <div style="display:flex;align-items:flex-end;padding-bottom:4px;">
                    <label style="display:flex;align-items:center;gap:6px;cursor:pointer;">
                        <input type="checkbox" class="ce-skill-enabled" data-i="${i}" ${t.skillEnabled!==false?'checked':''} style="width:18px;height:18px;accent-color:var(--secondary-cyan);">
                        <span style="font-size:0.5rem;color:${t.skillEnabled!==false?'var(--secondary-cyan)':'var(--text-dim)'};font-weight:700;">기술 ${t.skillEnabled!==false?'ON':'OFF'}</span>
                    </label>
                </div>
            </div>
            <div style="margin-top:8px;">
                <label style="font-size:0.45rem;color:var(--text-dim);">희귀도</label>
                <select class="ce-rarity btn-nav" style="width:100%;padding:6px;" data-i="${i}">
                    <option value="common" ${t.rarity==='common'?'selected':''}>일반</option>
                    <option value="rare" ${t.rarity==='rare'?'selected':''}>★희귀</option>
                    <option value="legendary" ${t.rarity==='legendary'?'selected':''}>★★전설</option>
                </select>
            </div>
        </div>`;
    });
}
async function saveCardTemplates() {
    const templates = await getCardTemplates();
    document.querySelectorAll('.ce-name').forEach((el,i) => {
        templates[i].name = el.value;
        templates[i].hp = parseInt(document.querySelectorAll('.ce-hp')[i].value);
        templates[i].atk = parseInt(document.querySelectorAll('.ce-atk')[i].value);
        templates[i].def = parseInt(document.querySelectorAll('.ce-def')[i].value);
        templates[i].skill = document.querySelectorAll('.ce-skill')[i].value;
        templates[i].skillChance = parseInt(document.querySelectorAll('.ce-schance')[i].value);
        templates[i].skillEnabled = document.querySelectorAll('.ce-skill-enabled')[i].checked;
        templates[i].rarity = document.querySelectorAll('.ce-rarity')[i].value;
    });
    await db.from('game_settings').upsert({name:'cardTemplates', value:templates});
    alert('카드 템플릿 저장 완료!');
}
async function saveDropSettings() {
    const s = {
        cardDrop: parseInt(document.getElementById('set-card-drop').value)||30,
        potionDrop: parseInt(document.getElementById('set-potion-drop').value)||30,
        bossCardDrop: parseInt(document.getElementById('set-boss-card-drop').value)||100
    };
    await db.from('game_settings').upsert({name:'dropSettings', value:s});
    alert('드랍 설정 저장!');
}
async function loadDropSettingsUI() {
    const s = await getDropSettings();
    document.getElementById('set-card-drop').value = s.cardDrop||30;
    document.getElementById('set-potion-drop').value = s.potionDrop||30;
    document.getElementById('set-boss-card-drop').value = s.bossCardDrop||100;
}
