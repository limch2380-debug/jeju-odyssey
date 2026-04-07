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
    drain: {name:'흡혈',icon:'🩸',desc:'흡혈 +N%',unit:'%'},
    gold_boost: {name:'조각 추가 획득',icon:'💎',desc:'수정조각 +N%',unit:'%'},
    reflect: {name:'반사',icon:'🪞',desc:'데미지 반사 N%',unit:'%'},
    thorns: {name:'가시',icon:'🌹',desc:'피격 시 N% 반격',unit:'%'},
    regen: {name:'재생',icon:'🌿',desc:'턴마다 HP N% 회복',unit:'%'}
};

// ===== 수정조각 시스템 =====
const DEFAULT_GAME_CONFIG = {
    playerBaseStats: { hp:100, atk:15, def:5 },
    shardCost: 10,
    passiveMin: 10,
    passiveMax: 20,
    shardDropRate: { normal:40, magic:55, rare:70, unique:85 },
    shardDropAmount: { normal: [1,2], magic: [1,3], rare: [2,4], unique: [3,6] },
    monsterDrops: {
        normal: { shardRate:40, potionRate:20 },
        magic: { shardRate:55, potionRate:25 },
        rare: { shardRate:70, potionRate:30 },
        unique: { shardRate:85, potionRate:40 }
    },
    craftRarityWeights: { common:50, magic:30, rare:15, unique:5 }
};

const DEFAULT_CARD_TEMPLATES = [
    { templateId:'goblin_soldier', name:'고블린 병사', img:'goblin_card.png',
      passives:['atk_boost','critical','dodge','hp_boost'], passiveCount:2, passiveMin:10, passiveMax:20 },
    { templateId:'goblin_archer', name:'고블린 궁수', img:'goblin_card.png',
      passives:['dodge','critical','drain','atk_boost'], passiveCount:2, passiveMin:10, passiveMax:20 },
    { templateId:'great_goblin', name:'대왕 고블린', img:'boss_goblin_card.png',
      passives:['hp_boost','drain','reflect','thorns'], passiveCount:3, passiveMin:15, passiveMax:30 }
];

// 카드 등급 결정 (패시브 수 + 수치로 자동 결정)
function determineCardRarity(passiveCount, totalPassiveValue) {
    // 패시브 4개 + 높은 수치 = 유니크, 3개 = 레어, 2개=매직, 1개=일반
    if (passiveCount >= 4 && totalPassiveValue >= 60) return 'unique';
    if (passiveCount >= 3 && totalPassiveValue >= 40) return 'rare';
    if (passiveCount >= 2 && totalPassiveValue >= 20) return 'magic';
    return 'common';
}

// 합성 시 등급 결정 (랜덤 가중치)
function pickCraftRarity(config) {
    const w = config.craftRarityWeights || DEFAULT_GAME_CONFIG.craftRarityWeights;
    const total = w.common + w.magic + w.rare + w.unique;
    const roll = Math.random() * total;
    let acc = 0;
    if ((acc += w.common) > roll) return { rarity: 'common', pCount: 1 };
    if ((acc += w.magic) > roll) return { rarity: 'magic', pCount: 2 };
    if ((acc += w.rare) > roll) return { rarity: 'rare', pCount: 3 };
    return { rarity: 'unique', pCount: 4 };
}

let selectedCardIdx = -1;
let equippedCardIdx = -1;


// DB helpers
async function getCardTemplates() {
    const {data} = await db.from('game_settings').select('value').eq('name','cardTemplates').single();
    if (!data) return DEFAULT_CARD_TEMPLATES;
    // 이전 포맷 호환: passive1/passive2 → passives 배열 변환
    const templates = data.value;
    templates.forEach(t => {
        if (!t.passives && t.passive1) {
            t.passives = [t.passive1];
            if (t.passive2) t.passives.push(t.passive2);
        }
        if (!t.passives) t.passives = ['atk_boost'];
    });
    return templates;
}
async function getGameConfig() {
    const {data} = await db.from('game_settings').select('value').eq('name','gameConfig').single();
    return data ? {...DEFAULT_GAME_CONFIG, ...data.value} : DEFAULT_GAME_CONFIG;
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

function rarityColor(r) { return RARITIES[r]?.color || '#fff'; }
function rarityBorder(r) { return RARITIES[r]?.border || 'rgba(255,255,255,0.2)'; }
function rarityLabel(r) { return RARITIES[r]?.name || '일반'; }

async function generateCard(template, forcedRarity = null) {
    const config = await getGameConfig();
    const pMin = template.passiveMin || config.passiveMin || 10;
    const pMax = template.passiveMax || config.passiveMax || 20;
    const rand = (min,max) => Math.floor(Math.random()*(max-min+1))+min;
    const allPassives = Object.keys(PASSIVE_SKILLS);
    const templatePassives = template.passives || [template.passive1 || 'atk_boost'];
    
    let passiveCount;
    if (forcedRarity) {
        // 합성 시: 등급에 따라 패시브 수 결정
        passiveCount = forcedRarity === 'unique' ? 4 : forcedRarity === 'rare' ? 3 : forcedRarity === 'magic' ? 2 : 1;
    } else {
        passiveCount = Math.min(template.passiveCount || 2, 4);
    }

    // 패시브 풀에서 랜덤 선택 (중복 방지)
    let chosenPassives = [];
    let availablePool = [...new Set([...templatePassives, ...allPassives])];
    for (let i = 0; i < passiveCount; i++) {
        if (availablePool.length === 0) break;
        const pick = availablePool.splice(rand(0, availablePool.length - 1), 1)[0];
        chosenPassives.push({ skill: pick, value: rand(pMin, pMax) });
    }

    let totalVal = chosenPassives.reduce((s,p) => s + p.value, 0);
    let rarity = forcedRarity || determineCardRarity(chosenPassives.length, totalVal);

    let card = {
        id: Date.now() + Math.floor(Math.random()*10000),
        templateId: template.templateId,
        name: template.name,
        img: template.img,
        rarity: rarity,
        passiveCount: chosenPassives.length,
        fusionCount: 0
    };
    // 패시브 저장 (최대 4개)
    chosenPassives.forEach((p, i) => {
        card[`passive${i+1}`] = p.skill;
        card[`passive${i+1}Value`] = p.value;
    });
    // 빈 슬롯 null 처리
    for (let i = chosenPassives.length; i < 4; i++) {
        card[`passive${i+1}`] = null;
        card[`passive${i+1}Value`] = 0;
    }
    return card;
}

// ===== 수정조각으로 카드 합성 =====
async function craftCardWithShards() {
    const config = await getGameConfig();
    const cost = config.shardCost || 10;
    const shards = await getShards();
    if (shards < cost) {
        alert(`수정조각이 부족합니다! (${shards}/${cost})`);
        return;
    }
    const inv = await getInventory();
    if (inv.length >= 20) {
        alert('인벤토리가 가득 찼습니다! (최대 20장)');
        return;
    }
    // 랜덤 등급 결정
    const { rarity } = pickCraftRarity(config);
    // 랜덤 템플릿 선택
    const templates = await getCardTemplates();
    const template = templates[Math.floor(Math.random() * templates.length)];
    // 카드 생성
    const card = await generateCard(template, rarity);
    inv.push(card);
    await saveInventory(inv);
    await saveShards(shards - cost);
    
    renderInventory();
    updateMainShards();
    if (typeof showCardDropPopup === 'function') showCardDropPopup(card);
}
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
        passiveText = `<div style="font-size:0.5rem;color:var(--secondary-cyan);margin-top:4px;">${getCardPassiveDetailText(c, ' / ')}</div>`;
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
    let hp=0,atk=0,def=0,crit=0,dodge=0,drain=0,gold=0,reflect=0,thorns=0,regen=0;
    const apply = (skill,val) => {
        if(skill==='hp_boost') hp+=val;
        else if(skill==='atk_boost') atk+=val;
        else if(skill==='def_boost') def+=val;
        else if(skill==='critical') crit+=val;
        else if(skill==='dodge') dodge+=val;
        else if(skill==='drain') drain+=val;
        else if(skill==='gold_boost') gold+=val;
        else if(skill==='reflect') reflect+=val;
        else if(skill==='thorns') thorns+=val;
        else if(skill==='regen') regen+=val;
    };
    for (let i = 1; i <= 4; i++) {
        if (card[`passive${i}`]) apply(card[`passive${i}`], card[`passive${i}Value`] || 0);
    }
    return {hp,atk,def,crit,dodge,drain,gold,reflect,thorns,regen};
}

// 카드 패시브 텍스트 생성 헬퍼
function getCardPassiveText(card, separator=' / ') {
    let parts = [];
    for (let i = 1; i <= 4; i++) {
        const sk = card[`passive${i}`];
        if (sk) {
            parts.push(`${PASSIVE_SKILLS[sk]?.icon||''} +${card[`passive${i}Value`]||0}%`);
        }
    }
    return parts.join(separator);
}

function getCardPassiveDetailText(card, separator=' / ') {
    let parts = [];
    for (let i = 1; i <= 4; i++) {
        const sk = card[`passive${i}`];
        if (sk) {
            parts.push(`${PASSIVE_SKILLS[sk]?.icon||''} ${PASSIVE_SKILLS[sk]?.name||sk} +${card[`passive${i}Value`]||0}%`);
        }
    }
    return parts.join(separator);
}

// ===== 인벤토리 UI =====
let expandedCardGroup = null; // 현재 펼쳐진 그룹의 templateId

async function renderInventory() {
    const inv = await getInventory();
    equippedCardIdx = await getEquippedIdx();
    document.getElementById('inv-count').innerText = `${inv.length} / 20`;
    
    // 수정조각 합성 패널 업데이트
    const shardPanel = document.getElementById('shard-craft-panel');
    if (shardPanel) {
        const shards = await getShards();
        const config = await getGameConfig();
        const cost = config.shardCost || 10;
        shardPanel.innerHTML = `
            <div style="display:flex;align-items:center;justify-content:space-between;">
                <div>
                    <div style="font-size:0.6rem;color:var(--text-dim);">💎 수정조각</div>
                    <div style="font-size:1.2rem;color:var(--secondary-cyan);font-weight:900;">${shards}</div>
                </div>
                <button class="btn-primary" style="padding:10px 20px;font-size:0.75rem;background:linear-gradient(135deg,var(--secondary-cyan),#0088ff);${shards < cost ? 'opacity:0.4;pointer-events:none;':''}" onclick="craftCardWithShards()">
                    💎×${cost} → 🃏 합성
                </button>
            </div>
            <div style="font-size:0.5rem;color:var(--text-dim);margin-top:6px;text-align:center;">일반50% / 매직30% / 레어15% / 유니크5%</div>
        `;
    }

    const grid = document.getElementById('inventory-grid');
    grid.innerHTML = '';
    
    // 같은 templateId끼리 그룹화
    const groups = {};
    inv.forEach((c, i) => {
        const key = c.templateId || c.name;
        if (!groups[key]) groups[key] = [];
        groups[key].push({ card: c, idx: i });
    });

    Object.entries(groups).forEach(([templateId, items]) => {
        const first = items[0].card;
        const rc = rarityColor(first.rarity);
        const rb = rarityBorder(first.rarity);
        const count = items.length;
        const hasEquipped = items.some(it => it.idx === equippedCardIdx);
        const isExpanded = expandedCardGroup === templateId;
        
        const div = document.createElement('div');
        div.className = 'glass-panel card-group';
        let borderC = hasEquipped ? rc : rb;
        let bgExtra = hasEquipped ? `background:${RARITIES[first.rarity]?.bg};box-shadow:0 0 15px ${rb};` : '';
        
        div.style.cssText = `padding:14px;text-align:center;border-color:${borderC};${bgExtra}cursor:pointer;position:relative;`;

        // 수량 뱃지
        let countBadge = '';
        if (count > 1) {
            countBadge = `<div style="position:absolute;top:6px;left:8px;background:linear-gradient(135deg,rgba(233,196,0,0.9),rgba(255,165,0,0.9));color:#1a1a1a;font-size:0.75rem;font-weight:900;padding:2px 8px;border-radius:10px;z-index:2;">×${count}</div>`;
        }
        // 장착 뱃지
        let equipBadge = '';
        if (hasEquipped) {
            equipBadge = `<div style="position:absolute;top:6px;right:8px;font-size:0.6rem;color:${rc};font-weight:700;">🎴 장착중</div>`;
        }

        // 대표 패시브 표시
        const passiveText = getCardPassiveText(first);
        
        div.innerHTML = `${countBadge}${equipBadge}
            <img src="${first.img}" style="width:65px;height:80px;object-fit:cover;border-radius:8px;border:2px solid ${rc};margin-bottom:6px;" onerror="this.src='goblin_card.png'">
            <div style="font-size:0.9rem;color:${rc};font-weight:700;">${first.name}</div>
            <div style="font-size:0.65rem;color:${rc};">[${rarityLabel(first.rarity)}]</div>
            ${count === 1 ? `<div style="font-size:0.55rem;color:var(--secondary-cyan);margin-top:4px;">${passiveText}</div>` : ''}
            ${count === 1 ? `
                <div style="display:flex;gap:4px;margin-top:8px;">
                    <button class="btn-primary" style="flex:1;padding:8px;font-size:0.7rem;" onclick="event.stopPropagation();equipCard(${items[0].idx})">${items[0].idx===equippedCardIdx?'해제':'장착'}</button>
                    <button class="btn-nav" style="padding:8px 10px;font-size:0.7rem;color:var(--accent-red);border-color:var(--accent-red);" onclick="event.stopPropagation();confirmDeleteCard(${first.id})">✕</button>
                </div>
            ` : `
                <div style="font-size:0.6rem;color:var(--secondary-cyan);margin-top:6px;">${isExpanded ? '▲ 접기' : '▼ 카드 선택'}</div>
            `}`;
        
        // 카드가 여러장일 때 클릭하면 확장
        if (count > 1) {
            div.onclick = () => {
                expandedCardGroup = (expandedCardGroup === templateId) ? null : templateId;
                renderInventory();
            };
        }

        grid.appendChild(div);

        // 확장된 그룹: 개별 카드 리스트 표시
        if (count > 1 && isExpanded) {
            const subContainer = document.createElement('div');
            subContainer.style.cssText = `grid-column: 1/-1; background:rgba(15,16,37,0.8); border:1px solid ${rb}; border-radius:12px; padding:12px; display:flex; flex-direction:column; gap:8px;`;
            
            const subTitle = document.createElement('div');
            subTitle.style.cssText = `font-size:0.75rem; color:${rc}; font-weight:700; text-align:center; margin-bottom:4px;`;
            subTitle.innerText = `${first.name} — 보유 ${count}장`;
            subContainer.appendChild(subTitle);

            items.forEach((it, subIdx) => {
                const c = it.card;
                const equipped = it.idx === equippedCardIdx;
                const crc = rarityColor(c.rarity);
                const subPassiveText = getCardPassiveDetailText(c, ' / ');
                
                const row = document.createElement('div');
                row.style.cssText = `display:flex; align-items:center; gap:10px; padding:10px 12px; border-radius:10px; border:1px solid ${equipped?crc:'rgba(255,255,255,0.06)'}; background:${equipped?RARITIES[c.rarity]?.bg:'rgba(25,26,42,0.5)'};`;
                
                row.innerHTML = `
                    <img src="${c.img}" style="width:40px;height:50px;object-fit:cover;border-radius:6px;border:2px solid ${equipped?crc:'rgba(255,255,255,0.15)'};" onerror="this.src='goblin_card.png'">
                    <div style="flex:1;text-align:left;">
                        <div style="font-size:0.75rem;color:${equipped?crc:'#fff'};font-weight:700;">#${subIdx+1} <span style='color:${crc};font-size:0.6rem;'>[${rarityLabel(c.rarity)}]</span> ${equipped?'🎴':''}</div>
                        <div style="font-size:0.55rem;color:var(--secondary-cyan);margin-top:2px;">${subPassiveText}</div>
                    </div>
                    <div style="display:flex;gap:4px;">
                        <button class="btn-primary" style="padding:7px 14px;font-size:0.65rem;" onclick="event.stopPropagation();equipCard(${it.idx})">${equipped?'해제':'장착'}</button>
                        <button class="btn-nav" style="padding:7px 10px;font-size:0.65rem;color:var(--accent-red);border-color:var(--accent-red);" onclick="event.stopPropagation();confirmDeleteCard(${c.id})">✕</button>
                    </div>
                `;
                subContainer.appendChild(row);
            });

            grid.appendChild(subContainer);
        }
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
            const passives = t.passives || [t.passive1];
            passives.forEach(pk => {
                if (pk) passiveHtml += `<div style="font-size:0.55rem;color:var(--secondary-cyan);margin-top:2px;">${PASSIVE_SKILLS[pk]?.icon||''} ${PASSIVE_SKILLS[pk]?.name||pk}</div>`;
            });
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

    const addBtn = document.createElement('button');
    addBtn.className = 'btn-primary';
    addBtn.style.cssText = 'width:100%; margin-bottom:20px; padding:15px; font-weight:900; background:linear-gradient(135deg,var(--secondary-cyan),#0088ff);';
    addBtn.innerText = '➕ 새 카드 템플릿 추가';
    addBtn.onclick = addNewCardTemplate;
    el.appendChild(addBtn);

    const passiveOpts = '<option value="">없음</option>' + Object.entries(PASSIVE_SKILLS).map(([k,v])=>`<option value="${k}">${v.icon} ${v.name}</option>`).join('');

    templates.forEach((t,i) => {
        const passiveCount = t.passiveCount || 2;
        const pMin = t.passiveMin || 10;
        const pMax = t.passiveMax || 20;
        const passives = t.passives || [t.passive1 || 'atk_boost'];
        const div = document.createElement('div');
        div.className = 'glass-panel';
        div.style.cssText = 'padding:15px; margin-bottom:12px;';
        
        // 패시브 슬롯 4개 생성
        let passiveSlotsHtml = '';
        for (let pi = 0; pi < 4; pi++) {
            const isActive = pi < passiveCount;
            passiveSlotsHtml += `
                <div class="ce-pw-${pi}" data-index="${i}" style="${!isActive?'opacity:0.3;pointer-events:none;':''}">
                    <label style="font-size:0.5rem;color:var(--text-dim);display:block;margin-bottom:3px;">패시브 ${pi+1}</label>
                    <select class="ce-passive btn-nav" data-slot="${pi}" data-tindex="${i}" style="width:100%;font-size:0.65rem;padding:5px;">${passiveOpts}</select>
                </div>`;
        }

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
            <!-- 패시브 개수 (1~4) -->
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:10px;padding:8px 12px;background:rgba(0,253,236,0.03);border-radius:8px;border:1px solid rgba(0,253,236,0.1);flex-wrap:wrap;">
                <span style="font-size:0.6rem;color:var(--secondary-cyan);font-weight:700;">패시브:</span>
                ${[1,2,3,4].map(n => `
                    <label style="display:flex;align-items:center;gap:3px;cursor:pointer;">
                        <input type="radio" name="ce-pcount-${i}" value="${n}" class="ce-pcount" data-index="${i}" ${passiveCount===n?'checked':''} style="accent-color:var(--secondary-cyan);">
                        <span style="font-size:0.65rem;color:#fff;">${n}개</span>
                    </label>`).join('')}
            </div>
            <!-- 패시브 수치 범위 -->
            <div style="display:flex;gap:8px;align-items:center;margin-bottom:10px;padding:8px 12px;background:rgba(233,196,0,0.03);border-radius:8px;border:1px solid rgba(233,196,0,0.1);">
                <span style="font-size:0.6rem;color:var(--primary-gold);font-weight:700;white-space:nowrap;">수치:</span>
                <input type="number" class="ce-pmin btn-nav" data-index="${i}" value="${pMin}" style="width:55px;text-align:center;padding:5px;font-size:0.75rem;">
                <span style="font-size:0.7rem;color:var(--text-dim);">~</span>
                <input type="number" class="ce-pmax btn-nav" data-index="${i}" value="${pMax}" style="width:55px;text-align:center;padding:5px;font-size:0.75rem;">
                <span style="font-size:0.5rem;color:var(--text-dim);">(랜덤%)</span>
            </div>
            <!-- 패시브 4슬롯 -->
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">${passiveSlotsHtml}</div>
        `;

        el.appendChild(div);
        // 패시브 선택 값 설정
        const selects = div.querySelectorAll('.ce-passive');
        selects.forEach((sel, pi) => {
            sel.value = passives[pi] || '';
        });
    });
    // 패시브 개수 변경 이벤트
    document.querySelectorAll('.ce-pcount').forEach(radio => {
        radio.addEventListener('change', (e) => {
            const idx = e.target.dataset.index;
            const val = parseInt(e.target.value);
            for (let pi = 0; pi < 4; pi++) {
                const wrap = document.querySelector(`.ce-pw-${pi}[data-index="${idx}"]`);
                if (wrap) {
                    wrap.style.opacity = pi < val ? '1' : '0.3';
                    wrap.style.pointerEvents = pi < val ? 'auto' : 'none';
                }
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
        passives: ['atk_boost', 'def_boost'],
        passiveCount: 2,
        passiveMin: 10,
        passiveMax: 20
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
    const pmins = document.querySelectorAll('.ce-pmin');
    const pmaxs = document.querySelectorAll('.ce-pmax');
    
    names.forEach((input,i) => {
        templates[i].name = input.value;
        // 패시브 개수
        const pcountRadio = document.querySelector(`input[name="ce-pcount-${i}"]:checked`);
        const pcount = pcountRadio ? parseInt(pcountRadio.value) : 2;
        templates[i].passiveCount = pcount;
        // 패시브 배열 수집
        let passives = [];
        for (let pi = 0; pi < pcount; pi++) {
            const sel = document.querySelector(`.ce-passive[data-tindex="${i}"][data-slot="${pi}"]`);
            if (sel && sel.value) passives.push(sel.value);
        }
        templates[i].passives = passives.length > 0 ? passives : ['atk_boost'];
        // 패시브 수치 범위
        templates[i].passiveMin = parseInt(pmins[i]?.value) || 10;
        templates[i].passiveMax = parseInt(pmaxs[i]?.value) || 20;
        // 레거시 필드 정리
        delete templates[i].passive1;
        delete templates[i].passive2;
        delete templates[i].shardId;
        delete templates[i].drops;
        delete templates[i].rates;
    });
    await db.from('game_settings').upsert({name:'cardTemplates', value:templates});
    alert('카드 템플릿 저장 완료!');
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
    const gv = (id,def) => parseInt(document.getElementById(id)?.value) || def;
    const config = {
        playerBaseStats: {
            hp: gv('cfg-base-hp',100),
            atk: gv('cfg-base-atk',15),
            def: gv('cfg-base-def',5)
        },
        shardCost: gv('cfg-shard-cost',10),
        passiveMin: gv('cfg-passive-min',10),
        passiveMax: gv('cfg-passive-max',20),
        shardDropRate: {
            normal: gv('cfg-shard-rate-normal',40),
            magic: gv('cfg-shard-rate-magic',55),
            rare: gv('cfg-shard-rate-rare',70),
            unique: gv('cfg-shard-rate-unique',85)
        },
        shardDropAmount: {
            normal: [gv('cfg-shard-min-normal',1), gv('cfg-shard-max-normal',2)],
            magic: [gv('cfg-shard-min-magic',1), gv('cfg-shard-max-magic',3)],
            rare: [gv('cfg-shard-min-rare',2), gv('cfg-shard-max-rare',4)],
            unique: [gv('cfg-shard-min-unique',3), gv('cfg-shard-max-unique',6)]
        },
        craftRarityWeights: {
            common: gv('cfg-craft-common',50),
            magic: gv('cfg-craft-magic',30),
            rare: gv('cfg-craft-rare',15),
            unique: gv('cfg-craft-unique',5)
        },
        monsterDrops: {
            normal: { potionRate: gv('cfg-drop-normal-potion',20) },
            magic: { potionRate: gv('cfg-drop-magic-potion',25) },
            rare: { potionRate: gv('cfg-drop-rare-potion',30) },
            unique: { potionRate: gv('cfg-drop-unique-potion',40) }
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
    // 수정조각 드랍
    const sr = c.shardDropRate || DEFAULT_GAME_CONFIG.shardDropRate;
    set('cfg-shard-rate-normal', sr.normal||40);
    set('cfg-shard-rate-magic', sr.magic||55);
    set('cfg-shard-rate-rare', sr.rare||70);
    set('cfg-shard-rate-unique', sr.unique||85);
    const sa = c.shardDropAmount || DEFAULT_GAME_CONFIG.shardDropAmount;
    set('cfg-shard-min-normal', sa.normal?.[0]||1); set('cfg-shard-max-normal', sa.normal?.[1]||2);
    set('cfg-shard-min-magic', sa.magic?.[0]||1); set('cfg-shard-max-magic', sa.magic?.[1]||3);
    set('cfg-shard-min-rare', sa.rare?.[0]||2); set('cfg-shard-max-rare', sa.rare?.[1]||4);
    set('cfg-shard-min-unique', sa.unique?.[0]||3); set('cfg-shard-max-unique', sa.unique?.[1]||6);
    // 합성 확률
    const cw = c.craftRarityWeights || DEFAULT_GAME_CONFIG.craftRarityWeights;
    set('cfg-craft-common', cw.common||50);
    set('cfg-craft-magic', cw.magic||30);
    set('cfg-craft-rare', cw.rare||15);
    set('cfg-craft-unique', cw.unique||5);
    // 포션
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
    const rc = rarityColor(card.rarity);
    const rl = rarityLabel(card.rarity);
    
    // 패시브 목록 (최대 4개)
    let passiveHtml = '';
    for (let i = 1; i <= 4; i++) {
        const sk = card[`passive${i}`];
        if (sk) {
            passiveHtml += `<div style="font-size:0.75rem;color:var(--secondary-cyan);margin-top:4px;">${PASSIVE_SKILLS[sk]?.icon||''} [${PASSIVE_SKILLS[sk]?.name||sk}] +${card[`passive${i}Value`]||0}%</div>`;
        }
    }

    popup.innerHTML = `
        <div style="text-align:center;animation:popIn 0.5s;">
            <div style="position:relative;width:150px;height:200px;margin:0 auto 20px;">
                <img src="${card.img}" style="width:100%;height:100%;object-fit:cover;border-radius:12px;border:3px solid ${rc};box-shadow:0 0 30px ${rc}80;animation:glow 1.5s infinite alternate;" onerror="this.src='goblin_card.png'">
            </div>
            <div style="font-size:1.4rem;color:${rc};font-weight:900;text-shadow:0 0 15px ${rc};letter-spacing:1px;margin-bottom:8px;">새로운 카드 획득!</div>
            <div style="font-size:1.1rem;color:#fff;font-weight:700;">${card.name}</div>
            <div style="font-size:0.85rem;color:${rc};font-weight:700;margin-top:4px;">[${rl}]</div>
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


