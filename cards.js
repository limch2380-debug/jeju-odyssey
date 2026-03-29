// ===== 카드 시스템 v2 =====
const RARITIES = {
    common: {name:'일반',color:'#ffffff',border:'rgba(255,255,255,0.4)',bg:'rgba(255,255,255,0.05)',skills:0},
    magic: {name:'매직',color:'#4488ff',border:'rgba(68,136,255,0.5)',bg:'rgba(68,136,255,0.08)',skills:0},
    rare: {name:'레어',color:'#ffdd00',border:'rgba(255,221,0,0.5)',bg:'rgba(255,221,0,0.08)',skills:1},
    unique: {name:'유니크',color:'#ffa500',border:'rgba(255,165,0,0.6)',bg:'rgba(255,165,0,0.1)',skills:2}
};
const FUSION_RULES = { common:{need:10,next:'magic'}, magic:{need:5,next:'rare'}, rare:{need:3,next:'unique'}, unique:{need:1,next:'unique'} };
const SKILLS = {
    double_attack:{name:'이중 어택',desc:'2회 연속 공격',icon:'⚔'},
    magic_attack:{name:'마법 공격',desc:'방어 무시 공격',icon:'🔮'},
    dodge:{name:'회피',desc:'적 공격 회피',icon:'💨'},
    critical:{name:'크리티컬',desc:'2배 데미지',icon:'💥'},
    drain:{name:'흡혈',desc:'데미지의 30% 회복',icon:'🩸'},
    none:{name:'없음',desc:'',icon:''}
};

const DEFAULT_CARD_TEMPLATES = [
    { templateId:'goblin_soldier', name:'고블린 병사', img:'goblin_card.png',
      hpMin:80,hpMax:120, atkMin:15,atkMax:25, defMin:5,defMax:15,
      skill1:'double_attack', skill1ChanceMin:10,skill1ChanceMax:30,
      skill2:'none', skill2ChanceMin:0,skill2ChanceMax:0,
      dropRates:{ normal:{common:40,magic:8,rare:2,unique:0}, boss:{common:0,magic:20,rare:10,unique:3} }
    },
    { templateId:'goblin_archer', name:'고블린 궁수', img:'goblin_card.png',
      hpMin:50,hpMax:80, atkMin:20,atkMax:35, defMin:3,defMax:10,
      skill1:'dodge', skill1ChanceMin:15,skill1ChanceMax:35,
      skill2:'critical', skill2ChanceMin:5,skill2ChanceMax:15,
      dropRates:{ normal:{common:35,magic:10,rare:3,unique:0}, boss:{common:0,magic:25,rare:12,unique:5} }
    },
    { templateId:'great_goblin', name:'대왕 고블린', img:'boss_goblin_card.png',
      hpMin:200,hpMax:300, atkMin:30,atkMax:50, defMin:15,defMax:30,
      skill1:'magic_attack', skill1ChanceMin:20,skill1ChanceMax:40,
      skill2:'drain', skill2ChanceMin:10,skill2ChanceMax:25,
      dropRates:{ normal:{common:0,magic:5,rare:5,unique:1}, boss:{common:0,magic:15,rare:20,unique:10} }
    }
];

let selectedCardIdx = -1;
let fusionSelections = new Set();

// DB helpers
async function getCardTemplates() {
    const {data} = await db.from('game_settings').select('value').eq('name','cardTemplates').single();
    return data ? data.value : DEFAULT_CARD_TEMPLATES;
}
async function getDropSettings() {
    const {data} = await db.from('game_settings').select('value').eq('name','dropSettings').single();
    return data ? data.value : {potionDrop:30};
}
async function getInventory() {
    const {data} = await db.from('player_state').select('*').eq('id','singleton').single();
    return data?.inventory || [];
}
async function saveInventory(inv) { await db.from('player_state').update({inventory:inv}).eq('id','singleton'); }
async function getSelectedIdx() {
    const {data} = await db.from('player_state').select('selected_card').eq('id','singleton').single();
    return data?.selected_card ?? -1;
}
async function setSelectedIdx(idx) { selectedCardIdx=idx; await db.from('player_state').update({selected_card:idx}).eq('id','singleton'); }

// Random in range
function randRange(min,max) { return Math.floor(Math.random()*(max-min+1))+min; }
function rarityColor(r) { return RARITIES[r]?.color||'#fff'; }
function rarityLabel(r) { return RARITIES[r]?.name||'일반'; }
function rarityBorder(r) { return RARITIES[r]?.border||'rgba(255,255,255,0.3)'; }

// Generate card from template with random stats
function generateCard(template, rarity='common') {
    const mult = rarity==='magic'?1.15 : rarity==='rare'?1.35 : rarity==='unique'?1.6 : 1;
    const hp = Math.floor(randRange(template.hpMin,template.hpMax)*mult);
    const atk = Math.floor(randRange(template.atkMin,template.atkMax)*mult);
    const def = Math.floor(randRange(template.defMin,template.defMax)*mult);
    const s1c = randRange(template.skill1ChanceMin||0, template.skill1ChanceMax||0);
    const s2c = randRange(template.skill2ChanceMin||0, template.skill2ChanceMax||0);
    const allowedSkills = RARITIES[rarity]?.skills || 0;
    return {
        id:Date.now()+Math.floor(Math.random()*1000), templateId:template.templateId,
        name:template.name, img:template.img, rarity,
        hp, atk, def,
        skill1: allowedSkills>=1 ? (template.skill1||'none') : 'none',
        skill1Chance: allowedSkills>=1 ? s1c : 0,
        skill2: allowedSkills>=2 ? (template.skill2||'none') : 'none',
        skill2Chance: allowedSkills>=2 ? s2c : 0,
        fusionCount: 0
    };
}

// Add card to inventory (max 10)
async function addCardToInventory(templateId, rarity='common') {
    const inv = await getInventory();
    if (inv.length >= 10) return false;
    const templates = await getCardTemplates();
    const t = templates.find(x=>x.templateId===templateId);
    if (!t) return false;
    inv.push(generateCard(t, rarity));
    await saveInventory(inv);
    return true;
}

async function deleteCard(cardId) {
    let inv = await getInventory();
    const idx = inv.findIndex(c=>c.id===cardId);
    if (idx===-1) return;
    if (selectedCardIdx===idx) { selectedCardIdx=-1; await setSelectedIdx(-1); }
    else if (selectedCardIdx>idx) { selectedCardIdx--; await setSelectedIdx(selectedCardIdx); }
    inv.splice(idx,1);
    await saveInventory(inv);
}

async function selectCard(idx) { await setSelectedIdx(idx); updateSelectedCardDisplay(); }

async function updateSelectedCardDisplay() {
    const inv = await getInventory();
    selectedCardIdx = await getSelectedIdx();
    const el = document.getElementById('selected-card-preview');
    if (!el) return;
    if (selectedCardIdx>=0 && selectedCardIdx<inv.length) {
        const c = inv[selectedCardIdx];
        const rc = rarityColor(c.rarity);
        const sk1 = c.skill1&&c.skill1!=='none' ? `${SKILLS[c.skill1]?.icon} ${SKILLS[c.skill1]?.name} ${c.skill1Chance}%` : '';
        const sk2 = c.skill2&&c.skill2!=='none' ? ` / ${SKILLS[c.skill2]?.icon} ${SKILLS[c.skill2]?.name} ${c.skill2Chance}%` : '';
        el.innerHTML = `<div style="display:flex;align-items:center;gap:12px;justify-content:center;">
            <img src="${c.img}" style="width:40px;height:50px;object-fit:cover;border-radius:6px;border:2px solid ${rc};" onerror="this.src='goblin_card.png'">
            <div style="text-align:left;"><div style="font-size:0.75rem;color:${rc};font-weight:700;">${c.name} <span style="font-size:0.5rem;">[${rarityLabel(c.rarity)}]</span></div>
            <div style="font-size:0.5rem;color:var(--text-dim);">HP:${c.hp} ATK:${c.atk} DEF:${c.def}</div>
            ${sk1?`<div style="font-size:0.45rem;color:var(--secondary-cyan);">${sk1}${sk2}</div>`:''}</div></div>`;
    } else {
        el.innerHTML = `<div style="color:var(--accent-red);font-size:0.7rem;">⚠ 카드를 선택해주세요</div>`;
    }
}

function tryStartAdventure() {
    if (selectedCardIdx<0) { alert('전투에 사용할 카드를 먼저 선택해주세요!'); return; }
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
    const fusEl = document.getElementById('fusion-selection');
    if(fusEl) fusEl.innerHTML = '';
    inv.forEach((c,i) => {
        const sel = i===selectedCardIdx;
        const rc = rarityColor(c.rarity);
        const rb = rarityBorder(c.rarity);
        const fused = fusionSelections.has(i);
        const sk1 = c.skill1&&c.skill1!=='none' ? `${SKILLS[c.skill1]?.icon} ${c.skill1Chance}%` : '';
        const sk2 = c.skill2&&c.skill2!=='none' ? ` ${SKILLS[c.skill2]?.icon} ${c.skill2Chance}%` : '';
        const rule = FUSION_RULES[c.rarity];
        const div = document.createElement('div');
        div.className = 'glass-panel';
        div.style.cssText = `padding:14px;text-align:center;border-color:${sel?rc:rb};${sel?`background:${RARITIES[c.rarity]?.bg};box-shadow:0 0 15px ${rb};`:''}cursor:pointer;position:relative;`;
        div.innerHTML = `${sel?'<div style="position:absolute;top:8px;right:10px;font-size:0.7rem;color:'+rc+';font-weight:700;">전투중</div>':''}
            <img src="${c.img}" style="width:65px;height:80px;object-fit:cover;border-radius:8px;border:2px solid ${rc};margin-bottom:6px;" onerror="this.src='goblin_card.png'">
            <div style="font-size:0.9rem;color:${rc};font-weight:700;">${c.name}</div>
            <div style="font-size:0.7rem;color:var(--text-dim);">[${rarityLabel(c.rarity)}] 합성: ${c.fusionCount||0}/${rule.need}</div>
            <div style="font-size:0.7rem;color:var(--text-dim);margin-top:4px;">HP:${c.hp} ATK:${c.atk} DEF:${c.def}</div>
            <div style="font-size:0.7rem;color:var(--secondary-cyan);">${sk1}${sk2}</div>
            <div style="display:flex;gap:4px;margin-top:8px;">
                <button class="btn-primary" style="flex:1;padding:8px;font-size:0.75rem;" onclick="event.stopPropagation();selectCard(${i})">전투</button>
                <button class="btn-nav" style="flex:1;padding:8px;font-size:0.75rem;text-align:center;${fused?'background:rgba(233,196,0,0.2);':''}" onclick="event.stopPropagation();toggleFusion(${i})">합성</button>
                <button class="btn-nav" style="padding:8px 10px;font-size:0.75rem;color:var(--accent-red);border-color:var(--accent-red);text-align:center;" onclick="event.stopPropagation();confirmDeleteCard(${c.id})">✕</button>
            </div>`;
        grid.appendChild(div);
    });
}

async function confirmDeleteCard(cardId) {
    if (!confirm('이 카드를 삭제하시겠습니까?')) return;
    await deleteCard(cardId); renderInventory(); updateSelectedCardDisplay();
}

function toggleFusion(idx) {
    if (fusionSelections.has(idx)) fusionSelections.delete(idx);
    else if (fusionSelections.size<2) fusionSelections.add(idx);
    const el = document.getElementById('fusion-selection');
    if(el) el.innerHTML = Array.from(fusionSelections).map(i=>`<span style="font-size:0.5rem;padding:4px 10px;border-radius:8px;background:rgba(233,196,0,0.1);color:var(--primary-gold);border:1px solid rgba(233,196,0,0.2);">슬롯${i+1}</span>`).join('');
}

async function fuseCards() {
    if (fusionSelections.size!==2) { alert('같은 등급의 카드 2장을 선택하세요.'); return; }
    const inv = await getInventory();
    const [a,b] = Array.from(fusionSelections).sort((x,y)=>x-y);
    if (!inv[a]||!inv[b]) return;
    if (inv[a].rarity !== inv[b].rarity) { alert('같은 등급(색상)의 카드만 합성 가능합니다.'); return; }
    const rarity = inv[a].rarity;
    const rule = FUSION_RULES[rarity];
    inv[a].fusionCount = (inv[a].fusionCount||0) + 1;
    if (inv[a].fusionCount >= rule.need) {
        // 등급 업!
        const templates = await getCardTemplates();
        const t = templates.find(x=>x.templateId===inv[a].templateId);
        if (t) {
            const newRarity = rule.next;
            const upgraded = generateCard(t, newRarity);
            upgraded.id = inv[a].id; // keep ID
            inv[a] = upgraded;
            alert(`🎉 ${upgraded.name} [${rarityLabel(newRarity)}] 등급으로 승급!`);
        }
    } else {
        // 능력치 소폭 증가
        inv[a].hp += Math.floor(inv[b].hp * 0.1);
        inv[a].atk += Math.floor(inv[b].atk * 0.1);
        inv[a].def += Math.floor(inv[b].def * 0.1);
        alert(`합성 완료! (${inv[a].fusionCount}/${rule.need}) 능력치 소폭 증가`);
    }
    inv.splice(b, 1);
    if (selectedCardIdx===b) { selectedCardIdx=-1; await setSelectedIdx(-1); }
    else if (selectedCardIdx>b) { selectedCardIdx--; await setSelectedIdx(selectedCardIdx); }
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
        const best = has ? owned.reduce((a,b)=>{
            const ro = ['common','magic','rare','unique'];
            return ro.indexOf(a.rarity)>ro.indexOf(b.rarity)?a:b;
        }) : null;
        const div = document.createElement('div');
        div.className = 'glass-panel';
        const rc = has ? rarityColor(best.rarity) : '#666';
        div.style.cssText = `padding:16px;text-align:center;${has?'':'opacity:0.4;'}border-color:${rc};`;
        div.innerHTML = `<img src="${t.img}" style="width:75px;height:90px;object-fit:cover;border-radius:8px;border:2px solid ${rc};margin-bottom:8px;${has?'':'filter:grayscale(1);'}" onerror="this.src='goblin_card.png'">
            <div style="font-size:0.85rem;color:${rc};font-weight:700;">${t.name}</div>
            <div style="font-size:0.7rem;color:var(--text-dim);margin-top:4px;">HP:${t.hpMin}~${t.hpMax} ATK:${t.atkMin}~${t.atkMax}</div>
            ${has?`<div style="font-size:0.7rem;color:var(--primary-gold);margin-top:4px;">보유 ${owned.length}장 | 최고 [${rarityLabel(best.rarity)}]</div>`:'<div style="font-size:0.7rem;color:var(--text-dim);margin-top:4px;">미발견</div>'}`;
        grid.appendChild(div);
    });
}

// ===== 카드 에디터 UI =====
async function renderCardEditor() {
    const templates = await getCardTemplates();
    const el = document.getElementById('card-editor-list');
    if(!el) return;
    el.innerHTML = '';
    const skillOpts = Object.entries(SKILLS).map(([k,v])=>`<option value="${k}">${v.icon} ${v.name}</option>`).join('');
    templates.forEach((t,i) => {
        const dr = t.dropRates || {normal:{common:30,magic:5,rare:1,unique:0},boss:{common:0,magic:15,rare:10,unique:5}};
        el.innerHTML += `<div class="glass-panel" style="margin-bottom:16px;padding:18px;border-left:4px solid ${t.templateId.includes('great')?'var(--primary-gold)':'var(--secondary-cyan)'}">
            <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;">
                <div style="position:relative;">
                    <img src="${t.img}" class="ce-img" data-i="${i}" style="width:60px;height:74px;object-fit:cover;border-radius:8px;cursor:pointer;" onerror="this.src='goblin_card.png'" onclick="document.getElementById('ce-file-${i}').click()">
                    <input type="file" id="ce-file-${i}" accept="image/*" style="display:none;" onchange="handleCardImgUpload(${i},this)">
                    <div style="font-size:0.65rem;color:var(--text-dim);text-align:center;margin-top:4px;">클릭 변경</div>
                </div>
                <div style="flex:1;"><input class="ce-name btn-nav" style="width:100%;padding:10px;font-size:1rem;" value="${t.name}" data-i="${i}"></div>
            </div>
            <div style="font-size:0.8rem;color:var(--secondary-cyan);margin-bottom:8px;font-weight:700;">📊 능력치 범위 (최소 ~ 최대)</div>
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:10px;">
                <div><label>HP min</label><input type="number" class="ce-hpmin btn-nav" style="width:100%;" value="${t.hpMin}" data-i="${i}"></div>
                <div><label>HP max</label><input type="number" class="ce-hpmax btn-nav" style="width:100%;" value="${t.hpMax}" data-i="${i}"></div>
                <div><label>ATK min</label><input type="number" class="ce-atkmin btn-nav" style="width:100%;" value="${t.atkMin}" data-i="${i}"></div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:10px;">
                <div><label>ATK max</label><input type="number" class="ce-atkmax btn-nav" style="width:100%;" value="${t.atkMax}" data-i="${i}"></div>
                <div><label>DEF min</label><input type="number" class="ce-defmin btn-nav" style="width:100%;" value="${t.defMin}" data-i="${i}"></div>
                <div><label>DEF max</label><input type="number" class="ce-defmax btn-nav" style="width:100%;" value="${t.defMax}" data-i="${i}"></div>
            </div>
            <div style="font-size:0.8rem;color:var(--primary-gold);margin:10px 0 8px;font-weight:700;">⚔ 고유기술 (레어/유니크 전용)</div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px;">
                <div><label>기술1</label><select class="ce-sk1 btn-nav" style="width:100%;" data-i="${i}">${skillOpts.replace(`value="${t.skill1}"`,`value="${t.skill1}" selected`)}</select></div>
                <div><label>확률 min~max%</label>
                    <div style="display:flex;gap:4px;"><input type="number" class="ce-s1min btn-nav" style="width:50%;" value="${t.skill1ChanceMin||0}" data-i="${i}"><input type="number" class="ce-s1max btn-nav" style="width:50%;" value="${t.skill1ChanceMax||0}" data-i="${i}"></div></div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px;">
                <div><label>기술2</label><select class="ce-sk2 btn-nav" style="width:100%;" data-i="${i}">${skillOpts.replace(`value="${t.skill2||'none'}"`,`value="${t.skill2||'none'}" selected`)}</select></div>
                <div><label>확률 min~max%</label>
                    <div style="display:flex;gap:4px;"><input type="number" class="ce-s2min btn-nav" style="width:50%;" value="${t.skill2ChanceMin||0}" data-i="${i}"><input type="number" class="ce-s2max btn-nav" style="width:50%;" value="${t.skill2ChanceMax||0}" data-i="${i}"></div></div>
            </div>
            <div style="font-size:0.8rem;color:var(--accent-red);margin:10px 0 8px;font-weight:700;">🎲 드랍률 (%) — 일반 / 보스</div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
                <div style="padding:10px;background:rgba(0,253,236,0.03);border-radius:10px;border:1px solid rgba(0,253,236,0.1);">
                    <div style="font-size:0.75rem;color:var(--secondary-cyan);margin-bottom:6px;font-weight:700;">일반 몬스터</div>
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">
                        <div><label style="color:#fff;">일반</label><input type="number" class="ce-dr-nc btn-nav" style="width:100%;" value="${dr.normal?.common||0}" data-i="${i}"></div>
                        <div><label style="color:#4488ff;">매직</label><input type="number" class="ce-dr-nm btn-nav" style="width:100%;" value="${dr.normal?.magic||0}" data-i="${i}"></div>
                        <div><label style="color:#ffdd00;">레어</label><input type="number" class="ce-dr-nr btn-nav" style="width:100%;" value="${dr.normal?.rare||0}" data-i="${i}"></div>
                        <div><label style="color:#ffa500;">유니크</label><input type="number" class="ce-dr-nu btn-nav" style="width:100%;" value="${dr.normal?.unique||0}" data-i="${i}"></div>
                    </div>
                </div>
                <div style="padding:10px;background:rgba(233,196,0,0.03);border-radius:10px;border:1px solid rgba(233,196,0,0.1);">
                    <div style="font-size:0.75rem;color:var(--primary-gold);margin-bottom:6px;font-weight:700;">보스 몬스터</div>
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">
                        <div><label style="color:#fff;">일반</label><input type="number" class="ce-dr-bc btn-nav" style="width:100%;" value="${dr.boss?.common||0}" data-i="${i}"></div>
                        <div><label style="color:#4488ff;">매직</label><input type="number" class="ce-dr-bm btn-nav" style="width:100%;" value="${dr.boss?.magic||0}" data-i="${i}"></div>
                        <div><label style="color:#ffdd00;">레어</label><input type="number" class="ce-dr-br btn-nav" style="width:100%;" value="${dr.boss?.rare||0}" data-i="${i}"></div>
                        <div><label style="color:#ffa500;">유니크</label><input type="number" class="ce-dr-bu btn-nav" style="width:100%;" value="${dr.boss?.unique||0}" data-i="${i}"></div>
                    </div>
                </div>
            </div>
        </div>`;
    });
}

async function saveCardTemplates() {
    const templates = await getCardTemplates();
    document.querySelectorAll('.ce-name').forEach((el,i) => {
        templates[i].name = el.value;
        templates[i].hpMin = parseInt(document.querySelectorAll('.ce-hpmin')[i].value)||0;
        templates[i].hpMax = parseInt(document.querySelectorAll('.ce-hpmax')[i].value)||0;
        templates[i].atkMin = parseInt(document.querySelectorAll('.ce-atkmin')[i].value)||0;
        templates[i].atkMax = parseInt(document.querySelectorAll('.ce-atkmax')[i].value)||0;
        templates[i].defMin = parseInt(document.querySelectorAll('.ce-defmin')[i].value)||0;
        templates[i].defMax = parseInt(document.querySelectorAll('.ce-defmax')[i].value)||0;
        templates[i].skill1 = document.querySelectorAll('.ce-sk1')[i].value;
        templates[i].skill1ChanceMin = parseInt(document.querySelectorAll('.ce-s1min')[i].value)||0;
        templates[i].skill1ChanceMax = parseInt(document.querySelectorAll('.ce-s1max')[i].value)||0;
        templates[i].skill2 = document.querySelectorAll('.ce-sk2')[i].value;
        templates[i].skill2ChanceMin = parseInt(document.querySelectorAll('.ce-s2min')[i].value)||0;
        templates[i].skill2ChanceMax = parseInt(document.querySelectorAll('.ce-s2max')[i].value)||0;
        templates[i].dropRates = {
            normal:{common:parseInt(document.querySelectorAll('.ce-dr-nc')[i].value)||0, magic:parseInt(document.querySelectorAll('.ce-dr-nm')[i].value)||0, rare:parseInt(document.querySelectorAll('.ce-dr-nr')[i].value)||0, unique:parseInt(document.querySelectorAll('.ce-dr-nu')[i].value)||0},
            boss:{common:parseInt(document.querySelectorAll('.ce-dr-bc')[i].value)||0, magic:parseInt(document.querySelectorAll('.ce-dr-bm')[i].value)||0, rare:parseInt(document.querySelectorAll('.ce-dr-br')[i].value)||0, unique:parseInt(document.querySelectorAll('.ce-dr-bu')[i].value)||0}
        };
    });
    await db.from('game_settings').upsert({name:'cardTemplates', value:templates});
    alert('카드 템플릿 저장!');
}

async function saveDropSettings() {
    const s = { potionDrop: parseInt(document.getElementById('set-potion-drop').value)||30 };
    await db.from('game_settings').upsert({name:'dropSettings', value:s});
    alert('드랍 설정 저장!');
}
async function loadDropSettingsUI() {
    const s = await getDropSettings();
    const el = document.getElementById('set-potion-drop');
    if(el) el.value = s.potionDrop||30;
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
    // Upload to Supabase storage
    const blob = await fetch(dataUrl).then(r=>r.blob());
    const {data,error} = await db.storage.from('game-assets').upload(fileName, blob, {upsert:true});
    if (error) { alert('업로드 실패: '+error.message); return; }
    const {data:urlData} = db.storage.from('game-assets').getPublicUrl(fileName);
    templates[idx].img = urlData.publicUrl;
    await db.from('game_settings').upsert({name:'cardTemplates', value:templates});
    const imgEl = document.querySelectorAll('.ce-img')[idx];
    if(imgEl) imgEl.src = urlData.publicUrl;
    alert('이미지 변경 완료! (자동 1MB 이하 리사이즈)');
}

// ===== 카드 드랍 판정 =====
async function rollCardDrop(enemyName, isBoss) {
    const templates = await getCardTemplates();
    const results = [];
    for (const t of templates) {
        const rates = isBoss ? t.dropRates?.boss : t.dropRates?.normal;
        if (!rates) continue;
        for (const [rarity, chance] of Object.entries(rates)) {
            if (chance > 0 && Math.random()*100 < chance) {
                const added = await addCardToInventory(t.templateId, rarity);
                if (added) results.push({name:t.name, rarity});
            }
        }
    }
    return results;
}
