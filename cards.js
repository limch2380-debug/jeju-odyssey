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
const FUSION_RULES = { common:{need:10,next:'magic'}, magic:{need:5,next:'rare'}, rare:{need:3,next:'unique'}, unique:{need:1,next:'unique'} };
const PASSIVE_SKILLS = {
    atk_boost: {name:'공격력 증가',icon:'⚔',desc:'ATK +N%',unit:'%'},
    def_boost: {name:'방어력 증가',icon:'🛡',desc:'DEF +N%',unit:'%'},
    hp_boost: {name:'체력 증가',icon:'❤',desc:'HP +N%',unit:'%'},
    critical: {name:'크리티컬',icon:'💥',desc:'크리율 +N%',unit:'%'},
    dodge: {name:'회피',icon:'💨',desc:'회피율 +N%',unit:'%'},
    drain: {name:'흡혈',icon:'🩸',desc:'흡혈 +N%',unit:'%'}
};

// ===== 수정조각 5종 시스템 =====
const SHARD_FRAGMENTS = {
    shard1: {name:'조각 1',icon:'💎',color:'#ff4466',hue:'hue-rotate(0deg) saturate(1.3)',glow:'rgba(255,68,102,0.5)'},
    shard2: {name:'조각 2',icon:'💎',color:'#44aaff',hue:'hue-rotate(200deg) saturate(1.3)',glow:'rgba(68,170,255,0.5)'},
    shard3: {name:'조각 3',icon:'💎',color:'#44ff88',hue:'hue-rotate(120deg) saturate(1.3)',glow:'rgba(68,255,136,0.5)'},
    shard4: {name:'조각 4',icon:'💎',color:'#ffaa00',hue:'hue-rotate(40deg) saturate(1.5)',glow:'rgba(255,170,0,0.5)'},
    shard5: {name:'조각 5',icon:'💎',color:'#cc44ff',hue:'hue-rotate(280deg) saturate(1.3)',glow:'rgba(204,68,255,0.5)'}
};

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
let fusionBaseIdx = -1;
let fusionMaterials = new Set();

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

// 조각 인벤토리 (5종 각각 보유 개수)
async function getFragments() {
    const uid = currentUserId || 'singleton';
    const {data} = await db.from('game_settings').select('value').eq('name', `fragments_${uid}`).single();
    return data?.value || {shard1:0, shard2:0, shard3:0, shard4:0, shard5:0};
}
async function saveFragments(frags) {
    const uid = currentUserId || 'singleton';
    await db.from('game_settings').upsert({name: `fragments_${uid}`, value: frags});
}
async function addFragment(shardKey) {
    const frags = await getFragments();
    frags[shardKey] = (frags[shardKey] || 0) + 1;
    await saveFragments(frags);
    return frags;
}
async function combineFragments(templateId) {
    const frags = await getFragments();
    // 5종 모두 1개 이상 필요
    const keys = Object.keys(SHARD_FRAGMENTS);
    for (const k of keys) {
        if ((frags[k] || 0) < 1) { alert('조각이 부족합니다!'); return false; }
    }
    // 차감
    for (const k of keys) frags[k]--;
    await saveFragments(frags);
    // 카드 생성
    const templates = await getCardTemplates();
    const t = templates.find(x => x.templateId === templateId);
    if (!t) { alert('카드 템플릿을 찾을 수 없습니다.'); return false; }
    const inv = await getInventory();
    if (inv.length >= 10) { alert('인벤토리가 가득 찼습니다! (최대 10장)'); return false; }
    const card = await generateCard(t);
    inv.push(card);
    await saveInventory(inv);
    return card;
}

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

// ===== 카드 제작 (수정조각 소모) =====
async function craftCard(templateId) {
    const config = await getGameConfig();
    const cost = config.shardCost || 10;
    const shards = await getShards();
    if (shards < cost) {
        alert(`수정조각이 부족합니다!\n현재: ${shards}개 / 필요: ${cost}개`);
        return;
    }
    const inv = await getInventory();
    if (inv.length >= 10) { alert('인벤토리가 가득 찼습니다! (최대 10장)'); return; }
    const templates = await getCardTemplates();
    const t = templates.find(x=>x.templateId===templateId);
    if(!t) { alert('존재하지 않는 카드입니다.'); return; }
    const card = await generateCard(t);
    inv.push(card);
    await saveInventory(inv);
    await saveShards(shards - cost);
    // 멋진 팝업
    let passiveMsg = `${PASSIVE_SKILLS[card.passive1]?.icon} ${PASSIVE_SKILLS[card.passive1]?.name}: +${card.passive1Value}%`;
    if (card.passiveCount >= 2 && card.passive2) {
        passiveMsg += `\n${PASSIVE_SKILLS[card.passive2]?.icon} ${PASSIVE_SKILLS[card.passive2]?.name}: +${card.passive2Value}%`;
    }
    alert(`🎉 카드 제작 성공!\n\n${card.name} [일반]\n\n패시브 스킬:\n${passiveMsg}\n\n수정조각: ${shards} → ${shards - cost}`);
    renderInventory();
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
    const el = document.getElementById('equipped-card-preview');
    if (!el) return;
    let bonusHp=0, bonusAtk=0, bonusDef=0, passiveText='';
    if (equippedCardIdx>=0 && equippedCardIdx<inv.length) {
        const c = inv[equippedCardIdx];
        const rc = rarityColor(c.rarity);
        // 패시브 보너스 계산
        const bonus = getPassiveBonus(c);
        bonusHp=bonus.hp; bonusAtk=bonus.atk; bonusDef=bonus.def;
        const p1 = `${PASSIVE_SKILLS[c.passive1]?.icon||''} ${PASSIVE_SKILLS[c.passive1]?.name||''} +${c.passive1Value}%`;
        let passiveText;
        if (c.passiveCount >= 2 && c.passive2) {
            const p2 = `${PASSIVE_SKILLS[c.passive2]?.icon||''} ${PASSIVE_SKILLS[c.passive2]?.name||''} +${c.passive2Value}%`;
            passiveText = `<div style="font-size:0.5rem;color:var(--secondary-cyan);margin-top:4px;">${p1} / ${p2}</div>`;
        } else {
            passiveText = `<div style="font-size:0.5rem;color:var(--secondary-cyan);margin-top:4px;">${p1}</div>`;
        }
        el.innerHTML = `<div style="display:flex;align-items:center;gap:12px;justify-content:center;">
            <img src="${c.img}" style="width:40px;height:50px;object-fit:cover;border-radius:6px;border:2px solid ${rc};" onerror="this.src='goblin_card.png'">
            <div style="text-align:left;"><div style="font-size:0.75rem;color:${rc};font-weight:700;">${c.name} <span style="font-size:0.5rem;">[${rarityLabel(c.rarity)}]</span></div>
            ${passiveText}</div></div>`;
    } else {
        el.innerHTML = '<div style="font-size:0.75rem;color:var(--text-dim);">장착된 카드 없음</div>';
    }
    // 최종 스탯 표시
    const finalEl = document.getElementById('player-final-stats');
    if(finalEl) {
        finalEl.innerHTML = `<span style="color:var(--accent-red);">HP:${Math.floor(base.hp*(1+bonusHp/100))}</span> <span style="color:var(--primary-gold);">ATK:${Math.floor(base.atk*(1+bonusAtk/100))}</span> <span style="color:var(--secondary-cyan);">DEF:${Math.floor(base.def*(1+bonusDef/100))}</span>`;
    }
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
    const shards = await getShards();
    const frags = await getFragments();
    equippedCardIdx = await getEquippedIdx();
    document.getElementById('inv-count').innerText = `${inv.length} / 10`;
    const shardEl = document.getElementById('shard-count');
    if(shardEl) shardEl.innerText = shards;
    // 조각 현황 패널
    const fragPanel = document.getElementById('inv-fragment-panel');
    if (fragPanel) {
        const keys = Object.keys(SHARD_FRAGMENTS);
        const canCombine = keys.every(k => (frags[k] || 0) >= 1);
        let html = '<div style="font-size:0.7rem;color:var(--primary-gold);font-weight:700;margin-bottom:8px;">💎 수정 조각 현황</div>';
        html += '<div style="display:grid;grid-template-columns:repeat(5,1fr);gap:4px;">';
        html += keys.map(k => {
            const s = SHARD_FRAGMENTS[k]; const count = frags[k] || 0;
            return `<div style="text-align:center;padding:5px 2px;border-radius:8px;border:1px solid ${count>0?s.color:'rgba(255,255,255,0.08)'};background:${count>0?`rgba(${hexToRgb(s.color)},0.06)`:'transparent'};">
                <div style="font-size:1.1rem;filter:${s.hue} ${count>0?'':'grayscale(0.8) opacity(0.3)'};">💎</div>
                <div style="font-size:0.45rem;color:${count>0?s.color:'var(--text-dim)'};margin-top:1px;">${s.name}</div>
                <div style="font-size:0.65rem;color:#fff;font-weight:900;">${count}</div>
            </div>`;
        }).join('');
        html += '</div>';
        if (canCombine) {
            html += `<button onclick="showCombineUI()" class="btn-primary" style="width:100%;margin-top:8px;padding:10px;font-size:0.8rem;font-weight:900;background:linear-gradient(135deg,var(--primary-gold),#ff8800);animation:pulse 1.5s infinite;">💎 조각 합치기 — 카드 생성</button>`;
        } else {
            html += `<button onclick="showCombineUI()" class="btn-nav" style="width:100%;margin-top:8px;padding:10px;font-size:0.75rem;text-align:center;border-color:rgba(255,170,0,0.2);color:var(--text-dim);">💎 조각 합치기 (5종 필요)</button>`;
        }
        fragPanel.innerHTML = html;
    }
    const drawPanel = document.getElementById('craft-card-panel');
    if (drawPanel) drawPanel.style.display = 'block';
    const grid = document.getElementById('inventory-grid');
    grid.innerHTML = '';
    updateFusionUI(inv);
    inv.forEach((c,i) => {
        const equipped = i===equippedCardIdx;
        const rc = rarityColor(c.rarity);
        const rb = rarityBorder(c.rarity);
        const isBase = fusionBaseIdx===i;
        const isMat = fusionMaterials.has(i);
        const rule = FUSION_RULES[c.rarity];
        const div = document.createElement('div');
        div.className = 'glass-panel';
        let borderC = equipped?rc:rb;
        let bgExtra = equipped?`background:${RARITIES[c.rarity]?.bg};box-shadow:0 0 15px ${rb};`:'';
        if (isBase) { borderC='var(--primary-gold)'; bgExtra='background:rgba(233,196,0,0.08);box-shadow:0 0 12px rgba(233,196,0,0.3);'; }
        if (isMat) { borderC='var(--accent-red)'; bgExtra='background:rgba(255,50,50,0.06);box-shadow:0 0 12px rgba(255,50,50,0.2);'; }
        div.style.cssText = `padding:14px;text-align:center;border-color:${borderC};${bgExtra}cursor:pointer;position:relative;`;
        let badge = '';
        if (equipped && !isBase && !isMat) badge = `<div style="position:absolute;top:8px;right:10px;font-size:0.6rem;color:${rc};font-weight:700;">🎴 장착</div>`;
        if (isBase) badge = `<div style="position:absolute;top:8px;right:10px;font-size:0.6rem;color:var(--primary-gold);font-weight:700;">⭐ 베이스</div>`;
        if (isMat) badge = `<div style="position:absolute;top:8px;right:10px;font-size:0.6rem;color:var(--accent-red);font-weight:700;">🔥 재료</div>`;
        const p1 = `${PASSIVE_SKILLS[c.passive1]?.icon||''} +${c.passive1Value||0}%`;
        const p2 = (c.passiveCount >= 2 && c.passive2) ? `${PASSIVE_SKILLS[c.passive2]?.icon||''} +${c.passive2Value||0}%` : '';
        const passiveDisplay = p2 ? `${p1} / ${p2}` : p1;
        let fuseBtnStyle = 'flex:1;padding:8px;font-size:0.7rem;text-align:center;';
        if (isBase) fuseBtnStyle += 'background:rgba(233,196,0,0.25);color:var(--primary-gold);';
        else if (isMat) fuseBtnStyle += 'background:rgba(255,50,50,0.2);color:var(--accent-red);';
        div.innerHTML = `${badge}
            <img src="${c.img}" style="width:65px;height:80px;object-fit:cover;border-radius:8px;border:2px solid ${rc};margin-bottom:6px;" onerror="this.src='goblin_card.png'">
            <div style="font-size:0.9rem;color:${rc};font-weight:700;">${c.name}</div>
            <div style="font-size:0.65rem;color:var(--text-dim);">[${rarityLabel(c.rarity)}] 합성: ${c.fusionCount||0}/${rule.need}</div>
            <div style="font-size:0.65rem;color:var(--secondary-cyan);margin-top:4px;">${passiveDisplay}</div>
            <div style="display:flex;gap:4px;margin-top:8px;">
                <button class="btn-primary" style="flex:1;padding:8px;font-size:0.7rem;" onclick="event.stopPropagation();equipCard(${i})">${equipped?'해제':'장착'}</button>
                <button class="btn-nav" style="${fuseBtnStyle}" onclick="event.stopPropagation();toggleFusion(${i})">${isBase?'⭐베이스':isMat?'🔥재료':'합성'}</button>
                <button class="btn-nav" style="padding:8px 10px;font-size:0.7rem;color:var(--accent-red);border-color:var(--accent-red);text-align:center;" onclick="event.stopPropagation();confirmDeleteCard(${c.id})">✕</button>
            </div>`;
        grid.appendChild(div);
    });
}

async function confirmDeleteCard(cardId) {
    if (!confirm('이 카드를 삭제하시겠습니까?')) return;
    await deleteCard(cardId); renderInventory(); updateEquippedCardDisplay();
}

function toggleFusion(idx) {
    if (fusionBaseIdx === idx) { fusionBaseIdx = -1; renderInventory(); return; }
    if (fusionMaterials.has(idx)) { fusionMaterials.delete(idx); renderInventory(); return; }
    if (fusionBaseIdx < 0) { fusionBaseIdx = idx; }
    else { fusionMaterials.add(idx); }
    renderInventory();
}

function updateFusionUI(inv) {
    const el = document.getElementById('fusion-selection');
    if(!el) return;
    let html = '';
    if (fusionBaseIdx>=0 && inv[fusionBaseIdx]) {
        const bc = inv[fusionBaseIdx];
        html += `<span style="font-size:0.6rem;padding:4px 10px;border-radius:8px;background:rgba(233,196,0,0.12);color:var(--primary-gold);border:1px solid rgba(233,196,0,0.3);">⭐ ${bc.name}(${bc.fusionCount||0})</span>`;
    }
    fusionMaterials.forEach(mi => {
        if (inv[mi]) html += `<span style="font-size:0.6rem;padding:4px 8px;border-radius:8px;background:rgba(255,50,50,0.1);color:var(--accent-red);border:1px solid rgba(255,50,50,0.2);">🔥${inv[mi].name}(${inv[mi].fusionCount||0})</span>`;
    });
    if (fusionBaseIdx>=0 && fusionMaterials.size>0) {
        const baseCount = inv[fusionBaseIdx]?.fusionCount || 0;
        let matTotal = 0;
        fusionMaterials.forEach(mi => { matTotal += Math.max(inv[mi]?.fusionCount || 0, 1); });
        const preview = baseCount + matTotal;
        const rule = FUSION_RULES[inv[fusionBaseIdx]?.rarity];
        html += `<span style="font-size:0.6rem;padding:4px 10px;border-radius:8px;background:rgba(0,253,236,0.1);color:var(--secondary-cyan);border:1px solid rgba(0,253,236,0.2);">→ 결과: ${preview}/${rule?.need||'?'}</span>`;
    }
    if (!html) html = '<span style="font-size:0.6rem;color:var(--text-dim);">1. ⭐베이스 선택 → 2. 🔥재료 선택 (다중 가능)</span>';
    el.innerHTML = html;
}

async function fuseCards() {
    if (fusionBaseIdx<0 || fusionMaterials.size===0) { alert('⭐ 베이스 카드와 🔥 재료 카드를 선택하세요.'); return; }
    const inv = await getInventory();
    const base = fusionBaseIdx;
    if (!inv[base]) return;
    const baseRarity = inv[base].rarity;
    for (const mi of fusionMaterials) {
        if (!inv[mi] || inv[mi].rarity !== baseRarity) {
            alert('같은 등급의 카드만 합성 가능합니다.'); return;
        }
    }
    let addedCount = 0;
    fusionMaterials.forEach(mi => { addedCount += Math.max(inv[mi].fusionCount || 0, 1); });
    inv[base].fusionCount = (inv[base].fusionCount || 0) + addedCount;
    const rule = FUSION_RULES[baseRarity];
    if (inv[base].fusionCount >= rule.need) {
        const newRarity = rule.next;
        const config = await getGameConfig();
        const pMin = config.passiveMin||10, pMax = config.passiveMax||20;
        const rand = (min,max)=>Math.floor(Math.random()*(max-min+1))+min;
        inv[base].rarity = newRarity;
        inv[base].fusionCount = 0;
        inv[base].passive1Value = rand(pMin, pMax);
        inv[base].passive2Value = rand(pMin, pMax);
        alert(`🎉 ${inv[base].name} [${rarityLabel(newRarity)}] 등급 승급!\n\n새 패시브:\n${PASSIVE_SKILLS[inv[base].passive1]?.icon} ${PASSIVE_SKILLS[inv[base].passive1]?.name}: +${inv[base].passive1Value}\n${PASSIVE_SKILLS[inv[base].passive2]?.icon} ${PASSIVE_SKILLS[inv[base].passive2]?.name}: +${inv[base].passive2Value}`);
    } else {
        alert(`합성 완료! (${inv[base].fusionCount}/${rule.need})\n다음 등급까지 ${rule.need - inv[base].fusionCount}회 남음\n소모된 재료: ${fusionMaterials.size}장`);
    }
    const matIndices = Array.from(fusionMaterials).sort((a,b)=>b-a);
    for (const mi of matIndices) {
        inv.splice(mi, 1);
        if (equippedCardIdx === mi) { equippedCardIdx = -1; }
        else if (equippedCardIdx > mi) { equippedCardIdx--; }
    }
    await setEquippedIdx(equippedCardIdx);
    await saveInventory(inv);
    fusionBaseIdx = -1;
    fusionMaterials.clear();
    renderInventory(); updateEquippedCardDisplay();
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
        div.style.cssText = `padding:14px; text-align:center; opacity:${opacity};`;
        div.innerHTML = `
            <img src="${found ? t.img : 'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 80 80%22><rect width=%2280%22 height=%2280%22 fill=%22%23222%22/><text x=%2240%22 y=%2250%22 text-anchor=%22middle%22 fill=%22%23555%22 font-size=%2230%22>?</text></svg>'}" style="width:70px;height:85px;object-fit:cover;border-radius:8px;border:2px solid ${found?'var(--primary-gold)':'#333'};margin-bottom:6px;" onerror="this.src='goblin_card.png'">
            <div style="font-size:0.8rem;color:${found?'var(--primary-gold)':'#555'};font-weight:700;">${found?t.name:'???'}</div>
            <div style="font-size:0.6rem;color:var(--text-dim);">${found?`보유: ${owned.length}장`:'미발견'}</div>`;
        grid.appendChild(div);
    });
}

async function renderCardEditor() {
    const templates = await getCardTemplates();
    const el = document.getElementById('card-editor-list');
    if(!el) return;
    el.innerHTML = '';
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
                <label class="btn-nav" style="padding:6px 10px;font-size:0.6rem;cursor:pointer;text-align:center;">📷<input type="file" accept="image/*" style="display:none;" onchange="handleCardImgUpload(${i},this)"></label>
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
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px;">
                <div><label style="font-size:0.55rem;color:var(--text-dim);">패시브1</label><select class="ce-p1 btn-nav" style="width:100%;">${passiveOpts}</select></div>
                <div class="ce-p2-wrap" data-index="${i}" style="${passiveCount<2?'opacity:0.3;pointer-events:none;':''}"><label style="font-size:0.55rem;color:var(--text-dim);">패시브2</label><select class="ce-p2 btn-nav" style="width:100%;">${passiveOpts}</select></div>
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

async function saveCardTemplates() {
    const templates = await getCardTemplates();
    const names = document.querySelectorAll('.ce-name');
    const p1s = document.querySelectorAll('.ce-p1');
    const p2s = document.querySelectorAll('.ce-p2');
    const pmins = document.querySelectorAll('.ce-pmin');
    const pmaxs = document.querySelectorAll('.ce-pmax');
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
    });
    await db.from('game_settings').upsert({name:'cardTemplates', value:templates});
    alert(`카드 템플릿 저장 완료!\n\n${templates.map(t => `${t.name}: 패시브 ${t.passiveCount}개, 수치 ${t.passiveMin}~${t.passiveMax}`).join('\n')}`);
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
            normal: { shardRate: parseInt(document.getElementById('cfg-drop-normal-shard')?.value)||40, potionRate: parseInt(document.getElementById('cfg-drop-normal-potion')?.value)||20 },
            magic: { shardRate: parseInt(document.getElementById('cfg-drop-magic-shard')?.value)||55, potionRate: parseInt(document.getElementById('cfg-drop-magic-potion')?.value)||25 },
            rare: { shardRate: parseInt(document.getElementById('cfg-drop-rare-shard')?.value)||70, potionRate: parseInt(document.getElementById('cfg-drop-rare-potion')?.value)||30 },
            unique: { shardRate: parseInt(document.getElementById('cfg-drop-unique-shard')?.value)||85, potionRate: parseInt(document.getElementById('cfg-drop-unique-potion')?.value)||40 }
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
    const d = c.monsterDrops||DEFAULT_GAME_CONFIG.monsterDrops;
    set('cfg-drop-normal-shard', d.normal?.shardRate||40);
    set('cfg-drop-normal-potion', d.normal?.potionRate||20);
    set('cfg-drop-magic-shard', d.magic?.shardRate||55);
    set('cfg-drop-magic-potion', d.magic?.potionRate||25);
    set('cfg-drop-rare-shard', d.rare?.shardRate||70);
    set('cfg-drop-rare-potion', d.rare?.potionRate||30);
    set('cfg-drop-unique-shard', d.unique?.shardRate||85);
    set('cfg-drop-unique-potion', d.unique?.potionRate||40);
}

// ===== 수정조각 획득 팝업 =====
function showShardPopup(shardKey) {
    const info = SHARD_FRAGMENTS[shardKey] || SHARD_FRAGMENTS.shard1;
    const popup = document.createElement('div');
    popup.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:9999;background:rgba(0,0,0,0.9);display:flex;align-items:center;justify-content:center;animation:fadeIn 0.3s;cursor:pointer;';
    popup.onclick = () => { popup.style.opacity='0'; popup.style.transition='opacity 0.3s'; setTimeout(()=>popup.remove(),300); };
    popup.innerHTML = `
        <div style="text-align:center;animation:popIn 0.5s;">
            <div style="position:relative;width:120px;height:120px;margin:0 auto 20px;">
                <img src="shard.png" style="width:120px;height:120px;object-fit:contain;filter:${info.hue} drop-shadow(0 0 25px ${info.glow}) drop-shadow(0 0 50px ${info.glow});animation:glow 1.5s infinite alternate;" onerror="this.outerHTML='<div style=font-size:5rem;>${info.icon}</div>'">
                <div style="position:absolute;inset:0;border-radius:50%;background:radial-gradient(circle,${info.glow} 0%,transparent 70%);opacity:0.4;animation:pulse 1.5s infinite;"></div>
            </div>
            <div style="font-size:1.4rem;color:${info.color};font-weight:900;text-shadow:0 0 20px ${info.glow};letter-spacing:2px;">${info.name} 획득!</div>
            <div style="font-size:0.8rem;color:var(--text-dim);margin-top:8px;">차원의 에너지가 결정화되었습니다</div>
            <div style="font-size:0.65rem;color:rgba(255,255,255,0.3);margin-top:15px;">화면을 터치하여 닫기</div>
        </div>`;
    document.body.appendChild(popup);
    if ('vibrate' in navigator) navigator.vibrate([100, 50, 200]);
    playSound('victory');
    setTimeout(() => { if(popup.parentNode) { popup.style.opacity='0'; popup.style.transition='opacity 0.3s'; setTimeout(()=>popup.remove(),300); }}, 3000);
}

// ===== 조각 합치기 UI =====
async function showCombineUI() {
    const frags = await getFragments();
    const templates = await getCardTemplates();
    const keys = Object.keys(SHARD_FRAGMENTS);
    const canCombine = keys.every(k => (frags[k] || 0) >= 1);
    const popup = document.createElement('div');
    popup.id = 'combine-popup';
    popup.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:9998;background:rgba(0,0,0,0.95);display:flex;align-items:flex-start;justify-content:center;animation:fadeIn 0.3s;overflow-y:auto;padding:15px;padding-top:40px;';
    let fragHTML = keys.map(k => {
        const s = SHARD_FRAGMENTS[k];
        const count = frags[k] || 0;
        const owned = count >= 1;
        return `<div style="text-align:center;padding:8px 4px;border-radius:10px;border:1px solid ${owned ? s.color : 'rgba(255,255,255,0.1)'};background:${owned ? `rgba(${hexToRgb(s.color)},0.08)` : 'rgba(255,255,255,0.02)'};">
            <div style="font-size:1.5rem;filter:${s.hue} ${owned?'':'grayscale(0.8) opacity(0.3)'};">💎</div>
            <div style="font-size:0.55rem;color:${owned ? s.color : 'var(--text-dim)'};margin-top:3px;font-weight:700;">${s.name}</div>
            <div style="font-size:0.6rem;color:${owned ? '#fff' : 'var(--text-dim)'};">${count}개</div>
        </div>`;
    }).join('');
    let templateHTML = templates.map(t => {
        return `<button onclick="doCombine('${t.templateId}')" style="display:flex;align-items:center;gap:8px;padding:10px;width:100%;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.15);border-radius:10px;color:#fff;cursor:pointer;margin-bottom:6px;font-size:0.8rem;${canCombine?'':'opacity:0.4;pointer-events:none;'}">
            <img src="${t.img}" style="width:35px;height:45px;object-fit:cover;border-radius:6px;" onerror="this.src='goblin_card.png'">
            <div style="text-align:left;"><div style="font-weight:700;">${t.name}</div><div style="font-size:0.6rem;color:var(--text-dim);">카드 생성</div></div>
        </button>`;
    }).join('');
    popup.innerHTML = `
        <div style="max-width:380px;width:100%;">
            <div style="text-align:center;margin-bottom:15px;">
                <div style="font-size:1.2rem;font-weight:900;color:var(--primary-gold);">💎 조각 합치기</div>
                <div style="font-size:0.7rem;color:var(--text-dim);margin-top:4px;">5종 조각을 모아 카드를 생성합니다</div>
            </div>
            <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:6px;margin-bottom:18px;">${fragHTML}</div>
            ${canCombine ? '<div style="text-align:center;color:var(--secondary-cyan);font-weight:700;margin-bottom:12px;font-size:0.85rem;animation:pulse 1s infinite;">✨ 합성 가능! 카드를 선택하세요</div>' : '<div style="text-align:center;color:var(--accent-red);font-size:0.75rem;margin-bottom:12px;">⚠ 5종 조각이 모두 필요합니다</div>'}
            <div style="max-height:180px;overflow-y:auto;">${templateHTML}</div>
            <button onclick="document.getElementById('combine-popup')?.remove()" class="btn-nav" style="width:100%;margin-top:12px;padding:12px;text-align:center;font-size:0.8rem;">닫기</button>
        </div>`;
    document.body.appendChild(popup);
}
async function doCombine(templateId) {
    const card = await combineFragments(templateId);
    if (!card) return;
    document.getElementById('combine-popup')?.remove();
    // 성공 팝업
    let passiveMsg = `${PASSIVE_SKILLS[card.passive1]?.icon} ${PASSIVE_SKILLS[card.passive1]?.name}: +${card.passive1Value}%`;
    if (card.passiveCount >= 2 && card.passive2) {
        passiveMsg += `\n${PASSIVE_SKILLS[card.passive2]?.icon} ${PASSIVE_SKILLS[card.passive2]?.name}: +${card.passive2Value}%`;
    }
    alert(`🎉 조각 합성 성공!\n\n${card.name} [일반]\n\n패시브 스킬:\n${passiveMsg}`);
    renderInventory();
    updateDashboardHUD();
}
function hexToRgb(hex) {
    const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
    return `${r},${g},${b}`;
}

// ===== 이미지 리사이즈 (1MB 이하) =====
function resizeImageFile(file, maxBytes=1000000) {
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
    const dataUrl = await resizeImageFile(file);
    const templates = await getCardTemplates();
    const ext = file.name.split('.').pop();
    const fileName = `card_${templates[idx].templateId}_${Date.now()}.${ext}`;
    const blob = await fetch(dataUrl).then(r=>r.blob());
    const {data,error} = await db.storage.from('game-assets').upload(fileName, blob, {upsert:true});
    if (error) { alert('업로드 실패: '+error.message); return; }
    const {data:urlData} = db.storage.from('game-assets').getPublicUrl(fileName);
    templates[idx].img = urlData.publicUrl;
    await db.from('game_settings').upsert({name:'cardTemplates', value:templates});
    const imgEl = document.querySelectorAll('.ce-img')[idx];
    if(imgEl) imgEl.src = urlData.publicUrl;
    alert('이미지 변경 완료!');
}
