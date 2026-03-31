// ===== 카드 시스템 v3 — 수정조각 + 제작 + 장착 =====
const RARITIES = {
    common: {name:'일반',color:'#ffffff',border:'rgba(255,255,255,0.4)',bg:'rgba(255,255,255,0.05)'},
    magic: {name:'매직',color:'#4488ff',border:'rgba(68,136,255,0.5)',bg:'rgba(68,136,255,0.08)'},
    rare: {name:'레어',color:'#ffdd00',border:'rgba(255,221,0,0.5)',bg:'rgba(255,221,0,0.08)'},
    unique: {name:'유니크',color:'#ffa500',border:'rgba(255,165,0,0.6)',bg:'rgba(255,165,0,0.1)'}
};
const MONSTER_TYPES = {
    normal: {name:'일반',color:'#ffffff',icon:'🗡',border:'rgba(255,255,255,0.3)'},
    magic: {name:'매직',color:'#4488ff',icon:'✨',border:'rgba(68,136,255,0.4)'},
    rare: {name:'레어',color:'#ffdd00',icon:'⚔',border:'rgba(255,221,0,0.4)'},
    unique: {name:'유니크',color:'#ffa500',icon:'👑',border:'rgba(255,165,0,0.5)'}
};

const PASSIVE_SKILLS = {
    atk_boost: {name:'공격력 증가',icon:'⚔',desc:'ATK +N%',unit:'%'},
    def_boost: {name:'방어력 증가',icon:'🛡',desc:'DEF +N%',unit:'%'},
    hp_boost: {name:'체력 증가',icon:'❤',desc:'HP +N%',unit:'%'},
    critical: {name:'크리티컬',icon:'💥',desc:'크리율 +N%',unit:'%'},
    dodge: {name:'회피',icon:'💨',desc:'회피율 +N%',unit:'%'},
    drain: {name:'흡혈',icon:'🩸',desc:'흡혈 +N%',unit:'%'}
};

// ===== 수정조각 5종 시스템 (삭제됨) =====
const DEFAULT_GAME_CONFIG = {
    playerBaseStats: { hp:100, atk:15, def:5 },
    shardCost: 10,
    passiveMin: 10,
    passiveMax: 20,
    monsterDrops: {
        normal: { shardRate:40, potionRate:20 },
        magic: { shardRate:55, potionRate:25 },
        rare: { shardRate:70, potionRate:30 },
        unique: { shardRate:85, potionRate:40 }
    }
};

const DEFAULT_CARD_TEMPLATES = [
    { templateId:'goblin_soldier', name:'고블린 병사', img:'goblin_card.png',
      passive1:'atk_boost', passive2:'critical', passiveCount:2, passiveMin:10, passiveMax:20 },
    { templateId:'goblin_archer', name:'고블린 궁수', img:'goblin_card.png',
      passive1:'dodge', passive2:'critical', passiveCount:2, passiveMin:10, passiveMax:20 },
    { templateId:'great_goblin', name:'대왕 고블린', img:'boss_goblin_card.png',
      passive1:'hp_boost', passive2:'drain', passiveCount:2, passiveMin:15, passiveMax:30 }
];

let selectedCardIdx = -1;
let equippedCardIdx = -1;


// DB helpers
async function getCardTemplates() {
    const {data} = await db.from('game_settings').select('value').eq('name','cardTemplates').single();
    return data ? data.value : DEFAULT_CARD_TEMPLATES;
}
async function getGameConfig() {
    const {data} = await db.from('game_settings').select('value').eq('name','gameConfig').single();
    return data ? data.value : DEFAULT_GAME_CONFIG;
}
async function getInventory() {
    const uid = currentUserId || 'singleton';
    const {data} = await db.from('player_state').select('inventory').eq('id', uid).single();
    return data?.inventory || [];
}
async function saveInventory(inv) {
    const uid = currentUserId || 'singleton';
    await db.from('player_state').update({inventory: inv}).eq('id', uid);
}
async function getShards() {
    const uid = currentUserId || 'singleton';
    const {data} = await db.from('player_state').select('shards').eq('id', uid).single();
    return data?.shards || 0;
}
async function saveShards(n) {
    const uid = currentUserId || 'singleton';
    await db.from('player_state').update({shards: n}).eq('id', uid);
}
async function getEquippedIdx() {
    const uid = currentUserId || 'singleton';
    const {data} = await db.from('player_state').select('equipped_card_idx').eq('id', uid).single();
    return data?.equipped_card_idx ?? -1;
}
async function setEquippedIdx(idx) {
    equippedCardIdx = idx;
    const uid = currentUserId || 'singleton';
    await db.from('player_state').update({equipped_card_idx: idx}).eq('id', uid);
}
async function getDropSettings() {
    const { data } = await db.from('game_settings').select('value').eq('name', 'dropSettings').single();
    return data ? data.value : { potionDrop: 30 };
}

// 조각 인벤토리 시스템 (삭제됨)

function rarityColor(r) { return RARITIES[r]?.color || '#fff'; }
function rarityBorder(r) { return RARITIES[r]?.border || 'rgba(255,255,255,0.2)'; }
function rarityLabel(r) { return RARITIES[r]?.name || '일반'; }

async function generateCard(template) {
    const config = await getGameConfig();
    const pMin = template.passiveMin || config.passiveMin || 10;
    const pMax = template.passiveMax || config.passiveMax || 20;
    const passiveCount = template.passiveCount || 2;
    const rand = (min,max) => Math.floor(Math.random()*(max-min+1))+min;
    const passiveKeys = Object.keys(PASSIVE_SKILLS).filter(k=>k!=='none');
    // 패시브 1종 또는 2종 랜덤 선택
    const p1 = template.passive1 || passiveKeys[rand(0,passiveKeys.length-1)];
    let card = {
        id: Date.now() + Math.floor(Math.random()*10000),
        templateId: template.templateId,
        name: template.name,
        img: template.img,
        rarity: 'common',
        passive1: p1, passive1Value: rand(pMin, pMax),
        passiveCount: passiveCount,
        fusionCount: 0
    };
    if (passiveCount >= 2) {
        const p2 = template.passive2 || passiveKeys.filter(k=>k!==p1)[rand(0,passiveKeys.length-2)] || 'def_boost';
        card.passive2 = p2;
        card.passive2Value = rand(pMin, pMax);
    } else {
        card.passive2 = null;
        card.passive2Value = 0;
    }
    return card;
}

// ===== 카드 제작 (수정조각 소모, 삭제됨) =====
// ===== 카드 삭제 =====
async function deleteCard(cardId) {
    let inv = await getInventory();
    const idx = inv.findIndex(c=>c.id===cardId);
    if (idx<0) return;
    inv.splice(idx, 1);
    if (equippedCardIdx === idx) { equippedCardIdx = -1; await setEquippedIdx(-1); }
    else if (equippedCardIdx > idx) { equippedCardIdx--; await setEquippedIdx(equippedCardIdx); }
    await saveInventory(inv);
}

// ===== 카드 장착 =====
async function equipCard(idx) {
    if (equippedCardIdx === idx) {
        // 이미 장착 중이면 해제
        await setEquippedIdx(-1);
    } else {
        await setEquippedIdx(idx);
    }
    renderInventory();
    updateEquippedCardDisplay();
}

async function updateEquippedCardDisplay() {
    const inv = await getInventory();
    equippedCardIdx = await getEquippedIdx();
    const config = await getGameConfig();
    const base = config.playerBaseStats || {hp:100,atk:15,def:5};
    const prevEls = document.querySelectorAll('.equipped-card-preview');
    const finalEls = document.querySelectorAll('.player-final-stats');

    let bonusHp=0, bonusAtk=0, bonusDef=0, passiveText='';
    let htmlContent = '<div style="font-size:0.75rem;color:var(--text-dim);">장착된 카드 없음</div>';
    
    if (equippedCardIdx>=0 && equippedCardIdx<inv.length) {
        const c = inv[equippedCardIdx];
        const rc = rarityColor(c.rarity);
        const bonus = getPassiveBonus(c);
        bonusHp=bonus.hp; bonusAtk=bonus.atk; bonusDef=bonus.def;
        const p1 = `${PASSIVE_SKILLS[c.passive1]?.icon||''} ${PASSIVE_SKILLS[c.passive1]?.name||''} +${c.passive1Value}%`;
        
        if (c.passiveCount >= 2 && c.passive2) {
            const p2 = `${PASSIVE_SKILLS[c.passive2]?.icon||''} ${PASSIVE_SKILLS[c.passive2]?.name||''} +${c.passive2Value}%`;
            passiveText = `<div style="font-size:0.5rem;color:var(--secondary-cyan);margin-top:4px;">${p1} / ${p2}</div>`;
        } else {
            passiveText = `<div style="font-size:0.5rem;color:var(--secondary-cyan);margin-top:4px;">${p1}</div>`;
        }
        htmlContent = `<div style="display:flex;align-items:center;gap:12px;justify-content:center;">
            <img src="${c.img}" style="width:40px;height:50px;object-fit:cover;border-radius:6px;border:2px solid ${rc};" onerror="this.src='goblin_card.png'">
            <div style="text-align:left;"><div style="font-size:0.75rem;color:${rc};font-weight:700;">${c.name} <span style="font-size:0.5rem;">[${rarityLabel(c.rarity)}]</span></div>
            ${passiveText}</div></div>`;
    }

    prevEls.forEach(el => el.innerHTML = htmlContent);

    const finalHtml = `<span style="color:var(--accent-red);">HP:${Math.floor(base.hp*(1+bonusHp/100))}</span> <span style="color:var(--primary-gold);">ATK:${Math.floor(base.atk*(1+bonusAtk/100))}</span> <span style="color:var(--secondary-cyan);">DEF:${Math.floor(base.def*(1+bonusDef/100))}</span>`;
    finalEls.forEach(el => el.innerHTML = finalHtml);
}

function getPassiveBonus(card) {
    let hp=0,atk=0,def=0,crit=0,dodge=0,drain=0;
    const apply = (skill,val) => {
        if(skill==='hp_boost') hp+=val;
        else if(skill==='atk_boost') atk+=val;
        else if(skill==='def_boost') def+=val;
        else if(skill==='critical') crit+=val;
        else if(skill==='dodge') dodge+=val;
        else if(skill==='drain') drain+=val;
    };
    if(card.passive1) apply(card.passive1, card.passive1Value||0);
    if(card.passive2) apply(card.passive2, card.passive2Value||0);
    return {hp,atk,def,crit,dodge,drain};
}

// ===== 인벤토리 UI =====
async function renderInventory() {
    const inv = await getInventory();
    equippedCardIdx = await getEquippedIdx();
    document.getElementById('inv-count').innerText = `${inv.length} / 10`;
    
    // 조각 현황 패널 삭제 처리
    const fragPanel = document.getElementById('inv-fragment-panel');
    if (fragPanel) {
        fragPanel.style.display = 'none';
        fragPanel.innerHTML = '';
    }
    const drawPanel = document.getElementById('craft-card-panel');
    if (drawPanel) drawPanel.style.display = 'none'; 

    const grid = document.getElementById('inventory-grid');
    grid.innerHTML = '';
    
    inv.forEach((c,i) => {
        const equipped = i===equippedCardIdx;
        const rc = rarityColor(c.rarity);
        const rb = rarityBorder(c.rarity);
        const div = document.createElement('div');
        div.className = 'glass-panel';
        let borderC = equipped?rc:rb;
        let bgExtra = equipped?`background:${RARITIES[c.rarity]?.bg};box-shadow:0 0 15px ${rb};`:'';
        
        div.style.cssText = `padding:14px;text-align:center;border-color:${borderC};${bgExtra}cursor:pointer;position:relative;`;
        let badge = '';
        if (equipped) badge = `<div style="position:absolute;top:8px;right:10px;font-size:0.6rem;color:${rc};font-weight:700;">🎴 장착</div>`;
        const p1 = `${PASSIVE_SKILLS[c.passive1]?.icon||''} +${c.passive1Value||0}%`;
        const p2 = (c.passiveCount >= 2 && c.passive2) ? `${PASSIVE_SKILLS[c.passive2]?.icon||''} +${c.passive2Value||0}%` : '';
        const passiveDisplay = p2 ? `${p1} / ${p2}` : p1;
        
        div.innerHTML = `${badge}
            <img src="${c.img}" style="width:65px;height:80px;object-fit:cover;border-radius:8px;border:2px solid ${rc};margin-bottom:6px;" onerror="this.src='goblin_card.png'">
            <div style="font-size:0.9rem;color:${rc};font-weight:700;">${c.name}</div>
            <div style="font-size:0.65rem;color:var(--text-dim);">[${rarityLabel(c.rarity)}]</div>
            <div style="font-size:0.65rem;color:var(--secondary-cyan);margin-top:4px;">${passiveDisplay}</div>
            <div style="display:flex;gap:4px;margin-top:8px;">
                <button class="btn-primary" style="flex:1;padding:8px;font-size:0.7rem;" onclick="event.stopPropagation();equipCard(${i})">${equipped?'해제':'장착'}</button>
                <button class="btn-nav" style="padding:8px 10px;font-size:0.7rem;color:var(--accent-red);border-color:var(--accent-red);text-align:center;" onclick="event.stopPropagation();confirmDeleteCard(${c.id})">✕ 삭제</button>
            </div>`;
        grid.appendChild(div);
    });
}

async function confirmDeleteCard(cardId) {
    if (!confirm('이 카드를 삭제하시겠습니까?')) return;
    await deleteCard(cardId); renderInventory(); updateEquippedCardDisplay();
}



// ===== 도감 UI =====
async function renderCollection() {
    const templates = await getCardTemplates();
    const inv = await getInventory();
    const grid = document.getElementById('collection-grid');
    if (!grid) return;
    grid.innerHTML = '';
    templates.forEach(t => {
        const owned = inv.filter(c=>c.templateId===t.templateId);
        const found = owned.length > 0;
        const div = document.createElement('div');
        div.className = 'glass-panel';
        const opacity = found ? '1' : '0.4';
        
        let passiveHtml = '';
        if (found) {
            const p1Icon = PASSIVE_SKILLS[t.passive1]?.icon || '';
            const p1Name = PASSIVE_SKILLS[t.passive1]?.name || t.passive1;
            passiveHtml += `<div style="font-size:0.55rem;color:var(--secondary-cyan);margin-top:4px;">${p1Icon} ${p1Name}</div>`;
            if (t.passiveCount >= 2 && t.passive2) {
                const p2Icon = PASSIVE_SKILLS[t.passive2]?.icon || '';
                const p2Name = PASSIVE_SKILLS[t.passive2]?.name || t.passive2;
                passiveHtml += `<div style="font-size:0.55rem;color:var(--secondary-cyan);">${p2Icon} ${p2Name}</div>`;
            }
        } else {
            passiveHtml = `<div style="font-size:0.55rem;color:var(--text-dim);margin-top:4px;">???</div>`;
        }

        div.style.cssText = `padding:14px; text-align:center; opacity:${opacity}; display:flex; flex-direction:column; justify-content:space-between;`;
        div.innerHTML = `
            <div>
                <img src="${found ? t.img : 'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 80 80%22><rect width=%2280%22 height=%2280%22 fill=%22%23222%22/><text x=%2240%22 y=%2250%22 text-anchor=%22middle%22 fill=%22%23555%22 font-size=%2230%22>?</text></svg>'}" style="width:70px;height:85px;object-fit:cover;border-radius:8px;border:2px solid ${found?'var(--primary-gold)':'#333'};margin-bottom:6px;" onerror="this.src='goblin_card.png'">
                <div style="font-size:0.8rem;color:${found?'var(--primary-gold)':'#555'};font-weight:700;">${found?t.name:'???'}</div>
            </div>
            <div>
                ${passiveHtml}
                <div style="font-size:0.6rem;color:var(--text-dim);margin-top:6px;">${found?`보유: ${owned.length}장`:'미발견'}</div>
            </div>`;
        grid.appendChild(div);
    });
}

async function renderCardEditor() {
    const templates = await getCardTemplates();
    const el = document.getElementById('card-editor-list');
    if(!el) return;
    el.innerHTML = '';

    // 몬스터 목록 불러오기
    let monsterPool = [];
    try {
        if (typeof getMonsterPool === 'function') monsterPool = await getMonsterPool();
    } catch(e) {}
    const mstOpts = '<option value="-1">선택 안함</option>' + monsterPool.map((m, idx) => `<option value="${idx}">[${idx+1}] ${m.name}</option>`).join('');

    // 추가 버튼 상단 배치
    const addBtn = document.createElement('button');
    addBtn.className = 'btn-primary';
    addBtn.style.cssText = 'width:100%; margin-bottom:20px; padding:15px; font-weight:900; background:linear-gradient(135deg,var(--secondary-cyan),#0088ff);';
    addBtn.innerText = '➕ 새 카드 템플릿 추가';
    addBtn.onclick = addNewCardTemplate;
    el.appendChild(addBtn);

    const passiveOpts = Object.entries(PASSIVE_SKILLS).map(([k,v])=>`<option value="${k}">${v.icon} ${v.name}</option>`).join('');

    templates.forEach((t,i) => {
        const passiveCount = t.passiveCount || 2;
        const pMin = t.passiveMin || 10;
        const pMax = t.passiveMax || 20;
        const div = document.createElement('div');
        div.className = 'glass-panel';
        div.style.cssText = 'padding:15px; margin-bottom:12px;';
        div.innerHTML = `
            <div style="display:flex;gap:10px;align-items:center;margin-bottom:10px;">
                <img src="${t.img}" class="ce-img" style="width:50px;height:60px;object-fit:cover;border-radius:6px;border:1px solid var(--glass-border);" onerror="this.src='goblin_card.png'">
                <div style="flex:1;">
                    <input type="text" class="ce-name btn-nav" value="${t.name}" style="width:100%;">
                </div>
                <div style="display:flex; flex-direction:column; gap:4px;">
                    <label class="btn-nav" style="padding:4px 8px;font-size:0.55rem;cursor:pointer;text-align:center;color:var(--secondary-cyan);border-color:var(--secondary-cyan);">📷 이미지<input type="file" accept="image/*" style="display:none;" onchange="handleCardImgUpload(${i},this)"></label>
                    <button class="btn-nav" style="padding:4px 8px;font-size:0.55rem;color:var(--accent-red);border-color:var(--accent-red);" onclick="deleteCardTemplate(${i})">🗑 삭제</button>
                </div>
            </div>

            <!-- 패시브 개수 설정 -->
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;padding:8px 12px;background:rgba(0,253,236,0.03);border-radius:8px;border:1px solid rgba(0,253,236,0.1);">
                <span style="font-size:0.6rem;color:var(--secondary-cyan);font-weight:700;">패시브 개수:</span>
                <label style="display:flex;align-items:center;gap:4px;cursor:pointer;">
                    <input type="radio" name="ce-pcount-${i}" value="1" class="ce-pcount" data-index="${i}" ${passiveCount===1?'checked':''} style="accent-color:var(--secondary-cyan);">
                    <span style="font-size:0.7rem;color:#fff;">1개</span>
                </label>
                <label style="display:flex;align-items:center;gap:4px;cursor:pointer;">
                    <input type="radio" name="ce-pcount-${i}" value="2" class="ce-pcount" data-index="${i}" ${passiveCount===2?'checked':''} style="accent-color:var(--secondary-cyan);">
                    <span style="font-size:0.7rem;color:#fff;">2개</span>
                </label>
            </div>
            <!-- 패시브 수치 범위 -->
            <div style="display:flex;gap:8px;align-items:center;margin-bottom:10px;padding:8px 12px;background:rgba(233,196,0,0.03);border-radius:8px;border:1px solid rgba(233,196,0,0.1);">
                <span style="font-size:0.6rem;color:var(--primary-gold);font-weight:700;white-space:nowrap;">패시브 수치:</span>
                <input type="number" class="ce-pmin btn-nav" data-index="${i}" value="${pMin}" style="width:60px;text-align:center;padding:6px;font-size:0.8rem;" placeholder="min">
                <span style="font-size:0.7rem;color:var(--text-dim);">~</span>
                <input type="number" class="ce-pmax btn-nav" data-index="${i}" value="${pMax}" style="width:60px;text-align:center;padding:6px;font-size:0.8rem;" placeholder="max">
                <span style="font-size:0.5rem;color:var(--text-dim);white-space:nowrap;">(랜덤)</span>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px;">
                <div><label style="font-size:0.55rem;color:var(--text-dim);display:block;margin-bottom:4px;">패시브 1</label><select class="ce-p1 btn-nav" style="width:100%;">${passiveOpts}</select></div>
                <div class="ce-p2-wrap" data-index="${i}" style="${passiveCount<2?'opacity:0.3;pointer-events:none;':''}"><label style="font-size:0.55rem;color:var(--text-dim);display:block;margin-bottom:4px;">패시브 2</label><select class="ce-p2 btn-nav" style="width:100%;">${passiveOpts}</select></div>
            </div>
            
            </div>`;

        el.appendChild(div);
        // 값 설정
        el.querySelectorAll('.ce-p1')[i].value = t.passive1 || 'atk_boost';
        el.querySelectorAll('.ce-p2')[i].value = t.passive2 || 'def_boost';
    });
    // 패시브 개수 라디오 변경 시 패시브2 활성/비활성
    document.querySelectorAll('.ce-pcount').forEach(radio => {
        radio.addEventListener('change', (e) => {
            const idx = e.target.dataset.index;
            const val = parseInt(e.target.value);
            const wrap = document.querySelector(`.ce-p2-wrap[data-index="${idx}"]`);
            if (wrap) {
                wrap.style.opacity = val >= 2 ? '1' : '0.3';
                wrap.style.pointerEvents = val >= 2 ? 'auto' : 'none';
            }
        });
    });
}

async function addNewCardTemplate() {
    const templates = await getCardTemplates();
    const newId = 'card_' + Date.now();
    templates.push({
        templateId: newId,
        name: '새로운 카드',
        img: 'goblin_card.png',
        passive1: 'atk_boost',
        passive2: 'def_boost',
        passiveCount: 2,
        passiveMin: 10,
        passiveMax: 20,
        shardId: 1
    });
    await db.from('game_settings').upsert({name:'cardTemplates', value:templates});
    renderCardEditor();
}

async function deleteCardTemplate(idx) {
    if(!confirm('정말 이 카드 템플릿을 삭제하시겠습니까?')) return;
    let templates = await getCardTemplates();
    templates.splice(idx, 1);
    await db.from('game_settings').upsert({name:'cardTemplates', value:templates});
    renderCardEditor();
}


async function saveCardTemplates() {
    const templates = await getCardTemplates();
    const names = document.querySelectorAll('.ce-name');
    const p1s = document.querySelectorAll('.ce-p1');
    const p2s = document.querySelectorAll('.ce-p2');
    const pmins = document.querySelectorAll('.ce-pmin');
    const pmaxs = document.querySelectorAll('.ce-pmax');
    
    // 조각 드랍 정보 저장
    names.forEach((input,i) => {
        templates[i].name = input.value;
        templates[i].passive1 = p1s[i]?.value || 'atk_boost';
        // 패시브 개수
        const pcountRadio = document.querySelector(`input[name="ce-pcount-${i}"]:checked`);
        const pcount = pcountRadio ? parseInt(pcountRadio.value) : 2;
        templates[i].passiveCount = pcount;
        if (pcount >= 2) {
            templates[i].passive2 = p2s[i]?.value || 'def_boost';
        } else {
            templates[i].passive2 = null;
        }
        // 패시브 수치 범위
        templates[i].passiveMin = parseInt(pmins[i]?.value) || 10;
        templates[i].passiveMax = parseInt(pmaxs[i]?.value) || 20;

        delete templates[i].shardId; // 이전 로직 호환성 위해 제거 (또는 방치)
        delete templates[i].drops;
        delete templates[i].rates;
    });
    await db.from('game_settings').upsert({name:'cardTemplates', value:templates});
    alert('카드 템플릿의 조각 분포 설정이 저장되었습니다!');
}


// ===== 드랍 설정 저장/로드 =====
async function saveDropSettings() {
    const s = { potionDrop: parseInt(document.getElementById('set-potion-drop')?.value)||30 };
    await db.from('game_settings').upsert({name:'dropSettings', value:s});
    alert('드랍 설정 저장!');
}
async function loadDropSettingsUI() {
    const s = await getDropSettings();
    const el = document.getElementById('set-potion-drop');
    if(el) el.value = s.potionDrop||30;
}

// ===== 게임 설정 저장/로드 =====
async function saveGameConfig() {
    const config = {
        playerBaseStats: {
            hp: parseInt(document.getElementById('cfg-base-hp')?.value)||100,
            atk: parseInt(document.getElementById('cfg-base-atk')?.value)||15,
            def: parseInt(document.getElementById('cfg-base-def')?.value)||5
        },
        shardCost: parseInt(document.getElementById('cfg-shard-cost')?.value)||10,
        passiveMin: parseInt(document.getElementById('cfg-passive-min')?.value)||10,
        passiveMax: parseInt(document.getElementById('cfg-passive-max')?.value)||20,
        monsterDrops: {
            normal: { potionRate: parseInt(document.getElementById('cfg-drop-normal-potion')?.value)||20 },
            magic: { potionRate: parseInt(document.getElementById('cfg-drop-magic-potion')?.value)||25 },
            rare: { potionRate: parseInt(document.getElementById('cfg-drop-rare-potion')?.value)||30 },
            unique: { potionRate: parseInt(document.getElementById('cfg-drop-unique-potion')?.value)||40 }
        }

    };
    await db.from('game_settings').upsert({name:'gameConfig', value:config});
    alert(`게임 설정 저장!\n\nHP:${config.playerBaseStats.hp} ATK:${config.playerBaseStats.atk} DEF:${config.playerBaseStats.def}\n수정조각 비용: ${config.shardCost}\n패시브 범위: ${config.passiveMin}~${config.passiveMax}`);
}
async function loadGameConfigUI() {
    const c = await getGameConfig();
    const set = (id,v) => { const el=document.getElementById(id); if(el) el.value=v; };
    set('cfg-base-hp', c.playerBaseStats?.hp||100);
    set('cfg-base-atk', c.playerBaseStats?.atk||15);
    set('cfg-base-def', c.playerBaseStats?.def||5);
    set('cfg-shard-cost', c.shardCost||10);
    set('cfg-passive-min', c.passiveMin||10);
    set('cfg-passive-max', c.passiveMax||20);
    const d = c.monsterDrops||{};
    set('cfg-drop-normal-potion', d.normal?.potionRate||20);
    set('cfg-drop-magic-potion', d.magic?.potionRate||25);
    set('cfg-drop-rare-potion', d.rare?.potionRate||30);
    set('cfg-drop-unique-potion', d.unique?.potionRate||40);

}

// ===== 카드 획득 팝업 =====
function showCardDropPopup(card) {
    const popup = document.createElement('div');
    popup.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:9999;background:rgba(0,0,0,0.9);display:flex;align-items:center;justify-content:center;animation:fadeIn 0.3s;cursor:pointer;';
    popup.onclick = () => { popup.style.opacity='0'; popup.style.transition='opacity 0.3s'; setTimeout(()=>popup.remove(),300); };
    let pMin = card.passive1Value || 0;
    let pMax = card.passive2Value || 0;
    let passiveHtml = `<div style="margin-top:10px;font-size:0.75rem;color:var(--secondary-cyan);">[${PASSIVE_SKILLS[card.passive1]?.name||''}] +${pMin}%</div>`;
    if(card.passive2) {
        passiveHtml += `<div style="font-size:0.75rem;color:var(--secondary-cyan);">[${PASSIVE_SKILLS[card.passive2]?.name||''}] +${pMax}%</div>`;
    }

    popup.innerHTML = `
        <div style="text-align:center;animation:popIn 0.5s;">
            <div style="position:relative;width:150px;height:200px;margin:0 auto 20px;">
                <img src="${card.img}" style="width:100%;height:100%;object-fit:cover;border-radius:12px;border:3px solid var(--primary-gold);box-shadow:0 0 30px rgba(255,215,0,0.6);animation:glow 1.5s infinite alternate;" onerror="this.src='goblin_card.png'">
            </div>
            <div style="font-size:1.4rem;color:gold;font-weight:900;text-shadow:0 0 15px yellow;letter-spacing:1px;margin-bottom:8px;">새로운 카드 획득!</div>
            <div style="font-size:1.1rem;color:#fff;font-weight:700;">${card.name}</div>
            ${passiveHtml}
            <div style="font-size:0.65rem;color:rgba(255,255,255,0.4);margin-top:20px;">화면을 터치하여 닫기</div>
        </div>`;
    document.body.appendChild(popup);
    if ('vibrate' in navigator) navigator.vibrate([100, 50, 200]);
    if (typeof playSound === 'function') playSound('victory');
    setTimeout(() => { if(popup.parentNode) { popup.style.opacity='0'; popup.style.transition='opacity 0.3s'; setTimeout(()=>popup.remove(),300); }}, 3000);
}


function hexToRgb(hex) {
    const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
    return `${r},${g},${b}`;
}

// ===== 이미지 리사이즈 (1MB 이하) =====
function resizeImageFile(file, maxBytes=300000) {

    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            if (file.size <= maxBytes) { resolve(e.target.result); return; }
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let w=img.width, h=img.height;
                const ratio = Math.sqrt(maxBytes / file.size) * 0.85;
                w = Math.floor(w*ratio); h = Math.floor(h*ratio);
                canvas.width=w; canvas.height=h;
                canvas.getContext('2d').drawImage(img,0,0,w,h);
                let quality = 0.8;
                let result = canvas.toDataURL('image/jpeg', quality);
                while (result.length * 0.75 > maxBytes && quality > 0.1) {
                    quality -= 0.1;
                    result = canvas.toDataURL('image/jpeg', quality);
                }
                resolve(result);
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    });
}

async function handleCardImgUpload(idx, input) {
    const file = input.files[0]; if(!file) return;
    const container = input.closest('.glass-panel');
    const imgEl = container.querySelector('.ce-img');
    if (imgEl) imgEl.style.opacity = '0.3';
    
    try {
        const dataUrl = await resizeImageFile(file, 300000); 
        const templates = await getCardTemplates();
        
        // 날짜를 포함해 겹치지 않는 파일명 생성 (monster-images 버킷 내 cards 폴더)
        const fileName = `cards/card_${Date.now()}.jpg`;
        
        // DataURL을 Blob으로 수동 변환 (가장 안정적)
        const byteString = atob(dataUrl.split(',')[1]);
        const mimeString = dataUrl.split(',')[0].split(':')[1].split(';')[0];
        const ab = new ArrayBuffer(byteString.length);
        const ia = new Uint8Array(ab);
        for (let i = 0; i < byteString.length; i++) ia[i] = byteString.charCodeAt(i);
        const blob = new Blob([ab], {type: mimeString});

        const { data, error } = await db.storage.from('monster-images').upload(fileName, blob, {
            contentType: 'image/jpeg',
            cacheControl: '3600',
            upsert: false 
        });

        if (error) throw error;
        
        const { data: { publicUrl } } = db.storage.from('monster-images').getPublicUrl(fileName);
        templates[idx].img = publicUrl;
        await db.from('game_settings').upsert({name: 'cardTemplates', value: templates});
        
        if(imgEl) { imgEl.src = publicUrl; imgEl.style.opacity = '1'; }
        alert(`✅ 카드 이미지 업로드 성공! (${(blob.size/1024).toFixed(0)}KB)`);
    } catch(e) {
        console.error('[STORAGE_ERROR]', e);
        alert('업로드 실패: ' + (e.message || '버킷 권한 설정을 확인하세요.'));
        if(imgEl) imgEl.style.opacity = '1';
    }
}


