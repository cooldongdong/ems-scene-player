// 情境資料層測試 —— 用 Node 內建 node:test，不需要安裝任何東西：
//     node --test
//
// 這裡載入的 js/scenarios.js 與 vendor/js-yaml.min.js 就是瀏覽器實際跑的那兩份檔案，
// 不是複製品，所以測試綠代表瀏覽器裡的行為也是這樣。

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const yaml = require('../vendor/js-yaml.min.js');
const S = require('../js/scenarios.js');

const { loadScenarios } = require('../tools/load-scenarios.js');

const ROOT = path.join(__dirname, '..');
const FILE_DATA = yaml.load(fs.readFileSync(path.join(ROOT, 'scenario-data.yaml'), 'utf8'));
// 情境已經拆到 scenarios/，一個檔一個。這裡**掃資料夾**而不是讀 scenarios/index.yaml：
// index 只是資料夾的副本，用副本去驗副本的話，index 漏一筆時測試會跟著漏。
// 瀏覽器沒得選（它列不出目錄），Node 這一端有——理由寫在 tools/load-scenarios.js。
const SCENARIO_FILES = loadScenarios(ROOT);
const DATA = { ...FILE_DATA, scenarios: SCENARIO_FILES.map(x => x.scenario) };
const OPTIONS = DATA.options;

// ---------- 真實資料 ----------

test('scenarios/ 的 7 組情境全部通過正規化，零警告', () => {
  const { scenarios, warnings } = S.normalizeScenarios(DATA.scenarios, OPTIONS);
  assert.deepEqual(warnings, []);
  assert.equal(scenarios.length, 7);
});

test('舊的 presets 鍵已經完全移除，不留相容層', () => {
  assert.equal('presets' in FILE_DATA, false);
});

test('scenario-data.yaml 不再帶 scenarios——情境的唯一住處是 scenarios/', () => {
  assert.equal('scenarios' in FILE_DATA, false);
  assert.deepEqual(Object.keys(FILE_DATA), ['options', 'assets']);
});

// 檔名 = id 是兩條路共用的約定：匯出用 id 當檔名（exportCurrentScenario），
// index.yaml 用檔名指路。兩邊對不上的話，匯出的檔丟進資料夾會變成第二筆同 id 情境。
test('scenarios/ 每個檔的檔名就是它的 id', () => {
  for (const { file, scenario } of SCENARIO_FILES) {
    assert.equal(file, `${scenario.id}.yaml`, `${file} 的 id 是「${scenario.id}」，對不上檔名`);
  }
});

test('scenarios/ 的每個檔都是「一個情境」，不是包了一層 scenarios 的清單', () => {
  for (const { file, scenario } of SCENARIO_FILES) {
    assert.equal('scenarios' in scenario, false, `${file} 多包了一層 scenarios`);
    assert.ok(Array.isArray(scenario.slides), `${file} 沒有 slides`);
  }
});

test('每個情境的 id 都是唯一且為 ASCII kebab-case', () => {
  const ids = DATA.scenarios.map(s => s.id);
  assert.equal(new Set(ids).size, ids.length, 'id 有重複');
  for (const id of ids) {
    assert.match(id, /^[a-z][a-z0-9-]*$/, `id「${id}」不是 ASCII kebab-case`);
  }
});

test('每頁都有 scene 圖層——場景是最底層，不該有哪一頁沒有背景', () => {
  const { scenarios } = S.normalizeScenarios(DATA.scenarios, OPTIONS);
  for (const s of scenarios) {
    assert.ok(s.slides.length >= 1, `${s.name} 沒有簡報頁`);
    for (const slide of s.slides) {
      assert.ok(S.layerOf(slide, 'scene'), `${s.name}／${slide.title} 沒有 scene 圖層`);
    }
  }
});

test('第一頁是純場景（沒有綠幕人物），流程要有一個乾淨的起點', () => {
  const { scenarios } = S.normalizeScenarios(DATA.scenarios, OPTIONS);
  for (const s of scenarios) {
    assert.equal(S.layerOf(s.slides[0], 'greenscreen'), null, `${s.name} 第一頁就有綠幕人物`);
  }
});

test('圖層一律排成固定的 z 順序，資料裡的順序不影響輸出', () => {
  const { scenarios } = S.normalizeScenarios([{
    id: 'x', name: 'x', environment: '工地', medicalEvent: '外傷出血',
    slides: [{
      id: 's1', title: 'a',
      // 故意倒過來寫
      layers: [
        { type: 'greenscreen', complication: '旁人嗆聲干擾' },
        { type: 'patient' },
        { type: 'scene' },
      ],
    }],
  }], OPTIONS);
  assert.deepEqual(scenarios[0].slides[0].layers.map(l => l.type),
    ['scene', 'patient', 'greenscreen']);
});

// 這組數字來自轉換前的 preset，是這次遷移不能改動的事實
const 遷移前的突發狀況 = {
  'home-ohca': ['家屬崩潰哭喊'],
  'studio-selfharm': ['情緒失控自傷'],
  'street-trauma': ['旁人嗆聲干擾', '同事欲搬動傷患'],
  'street-fall': ['同事欲搬動傷患'],
  'intersection-crash': ['肇事雙方爭吵', '旁人嗆聲干擾'],
  'site-trauma': ['同事欲搬動傷患', '旁人嗆聲干擾'],
  'site-fall': ['同事欲搬動傷患'],
};

test('由 slides 推導出的突發狀況，與遷移前的 preset 完全一致', () => {
  const { scenarios } = S.normalizeScenarios(DATA.scenarios, OPTIONS);
  for (const s of scenarios) {
    assert.deepEqual(S.complicationsOf(s), 遷移前的突發狀況[s.id], `${s.id} 推導結果不符`);
  }
});

// ---------- 推導 ----------

test('關掉的頁不列入突發狀況的推導，也不會被播放', () => {
  const scenario = {
    id: 'x', name: 'x', environment: '工地', medicalEvent: '外傷出血',
    slides: [
      { id: 'a', title: 'a', enabled: true, layers: [{ type: 'greenscreen', complication: '旁人嗆聲干擾' }] },
      { id: 'b', title: 'b', enabled: false, layers: [{ type: 'greenscreen', complication: '同事欲搬動傷患' }] },
    ],
  };
  assert.deepEqual(S.complicationsOf(scenario), ['旁人嗆聲干擾']);
  assert.deepEqual(S.playableSlides(scenario).map(s => s.id), ['a']);
});

test('關掉的頁仍留在清單裡（是跳過，不是刪除）', () => {
  const { scenarios } = S.normalizeScenarios([{
    id: 'x', name: 'x', environment: '工地', medicalEvent: '外傷出血',
    slides: [
      { id: 'a', title: 'a', layers: [{ type: 'scene' }] },
      { id: 'b', title: 'b', enabled: false, layers: [{ type: 'greenscreen', complication: '旁人嗆聲干擾' }] },
    ],
  }], OPTIONS);
  assert.equal(scenarios[0].slides.length, 2);
  assert.equal(scenarios[0].slides[1].enabled, false);
});

test('同一個突發狀況出現在多頁時，推導結果只算一次且保留首次出現的順序', () => {
  const scenario = {
    slides: [
      { layers: [{ type: 'greenscreen', complication: '旁人嗆聲干擾' }] },
      { layers: [{ type: 'greenscreen', complication: '同事欲搬動傷患' }] },
      { layers: [{ type: 'greenscreen', complication: '旁人嗆聲干擾' }] },
    ],
  };
  assert.deepEqual(S.complicationsOf(scenario), ['旁人嗆聲干擾', '同事欲搬動傷患']);
});

test('enabled 省略時視為啟用', () => {
  const { scenarios } = S.normalizeScenarios([{
    id: 'x', name: 'x', environment: '工地', medicalEvent: '外傷出血',
    slides: [{ id: 'a', title: 'a', layers: [{ type: 'scene' }] }],
  }], OPTIONS);
  assert.equal(scenarios[0].slides[0].enabled, true);
});

// ---------- 圖層 ----------

test('版面值省略時補預設，且只補該型別有的欄位', () => {
  const { scenarios } = S.normalizeScenarios([{
    id: 'x', name: 'x', environment: '工地', medicalEvent: '外傷出血',
    slides: [{ id: 'a', title: 'a', layers: [
      { type: 'scene' }, { type: 'patient' },
      { type: 'greenscreen', complication: '旁人嗆聲干擾' },
    ] }],
  }], OPTIONS);
  const [scene, patient, green] = scenarios[0].slides[0].layers;
  assert.deepEqual(scene, { type: 'scene' });                    // 場景滿版，沒有位置欄位
  assert.deepEqual(patient, { type: 'patient', ...S.LAYER_DEFAULTS.patient });
  assert.equal(green.tolerance, S.LAYER_DEFAULTS.greenscreen.tolerance);
});

test('超出滑桿範圍的版面值被夾回來，不是整層丟掉', () => {
  const { scenarios } = S.normalizeScenarios([{
    id: 'x', name: 'x', environment: '工地', medicalEvent: '外傷出血',
    slides: [{ id: 'a', title: 'a', layers: [{ type: 'patient', size: 999, x: -50, y: 'abc' }] }],
  }], OPTIONS);
  const p = S.layerOf(scenarios[0].slides[0], 'patient');
  assert.equal(p.size, S.LAYER_RANGES.size[1]);
  assert.equal(p.x, S.LAYER_RANGES.x[0]);
  assert.equal(p.y, S.LAYER_DEFAULTS.patient.y, '非數字要回到預設值');
});

test('一頁每種圖層最多一個，多的丟掉並警告', () => {
  const { scenarios, warnings } = S.normalizeScenarios([{
    id: 'x', name: 'x', environment: '工地', medicalEvent: '外傷出血',
    slides: [{ id: 'a', title: 'a', layers: [
      { type: 'patient', size: 50 }, { type: 'patient', size: 90 },
    ] }],
  }], OPTIONS);
  const patients = scenarios[0].slides[0].layers.filter(l => l.type === 'patient');
  assert.equal(patients.length, 1);
  assert.equal(patients[0].size, 50, '保留第一個');
  assert.match(warnings.join(''), /多個 patient/);
});

test('text 圖層沒有內容就跳過；有內容才留下', () => {
  const { scenarios, warnings } = S.normalizeScenarios([{
    id: 'x', name: 'x', environment: '工地', medicalEvent: '外傷出血',
    slides: [
      { id: 'a', title: 'a', layers: [{ type: 'scene' }, { type: 'text', text: '  ' }] },
      { id: 'b', title: 'b', layers: [{ type: 'scene' }, { type: 'text', text: '準備交班' }] },
    ],
  }], OPTIONS);
  assert.equal(S.layerOf(scenarios[0].slides[0], 'text'), null);
  assert.equal(S.layerOf(scenarios[0].slides[1], 'text').text, '準備交班');
  assert.match(warnings.join(''), /text 圖層沒有內容/);
});

test('slide.note 是給教官的提詞，不會變成 text 圖層', () => {
  const { scenarios } = S.normalizeScenarios([{
    id: 'x', name: 'x', environment: '工地', medicalEvent: '外傷出血',
    slides: [{ id: 'a', title: 'a', note: '提醒隊員注意工地危害', layers: [{ type: 'scene' }] }],
  }], OPTIONS);
  const slide = scenarios[0].slides[0];
  assert.equal(slide.note, '提醒隊員注意工地危害');
  assert.equal(S.layerOf(slide, 'text'), null, 'note 絕不能變成投影出去的字');
});

test('釘選素材（asset）被保留；不填就是 auto', () => {
  const { scenarios } = S.normalizeScenarios([{
    id: 'x', name: 'x', environment: '工地', medicalEvent: '外傷出血',
    slides: [{ id: 'a', title: 'a', layers: [
      { type: 'scene', asset: 'ev005' }, { type: 'patient' },
    ] }],
  }], OPTIONS);
  assert.equal(S.layerOf(scenarios[0].slides[0], 'scene').asset, 'ev005');
  assert.equal(S.layerOf(scenarios[0].slides[0], 'patient').asset, undefined);
});

test('ambience 預設 auto，可指定 none', () => {
  const { scenarios } = S.normalizeScenarios([
    { id: 'a', name: 'a', environment: '工地', medicalEvent: '外傷出血',
      slides: [{ id: 's1', title: 'a', layers: [{ type: 'scene' }] }] },
    { id: 'b', name: 'b', environment: '工地', medicalEvent: '外傷出血', ambience: 'none',
      slides: [{ id: 's1', title: 'a', layers: [{ type: 'scene' }] }] },
  ], OPTIONS);
  assert.equal(scenarios[0].ambience, 'auto');
  assert.equal(scenarios[1].ambience, 'none');
});

// ---------- 壞資料 ----------

test('壞資料被跳過並留警告，不會讓整份載入失敗', () => {
  const raw = [
    { id: 'good', name: '好的', environment: '工地', medicalEvent: '外傷出血',
      slides: [{ id: 's1', title: 'a', layers: [{ type: 'scene' }] }] },
    { id: 'bad-env', name: '壞環境', environment: '不存在的環境', medicalEvent: '外傷出血',
      slides: [{ id: 's1', title: 'a', layers: [{ type: 'scene' }] }] },
    { id: 'bad-med', name: '壞事件', environment: '工地', medicalEvent: '不存在的事件',
      slides: [{ id: 's1', title: 'a', layers: [{ type: 'scene' }] }] },
    { id: 'no-slides', name: '空流程', environment: '工地', medicalEvent: '外傷出血', slides: [] },
    { id: 'bad-comp', name: '壞狀況', environment: '工地', medicalEvent: '外傷出血',
      slides: [{ id: 's1', title: 'a', layers: [{ type: 'greenscreen', complication: '沒這個狀況' }] }] },
    { id: 'bad-type', name: '壞型別', environment: '工地', medicalEvent: '外傷出血',
      slides: [{ id: 's1', title: 'a', layers: [{ type: 'explode' }] }] },
  ];
  const { scenarios, warnings } = S.normalizeScenarios(raw, OPTIONS);
  assert.deepEqual(scenarios.map(s => s.id), ['good']);
  assert.equal(warnings.length >= 5, true, `警告太少：${warnings.length}`);
});

// 病患預設位置放在情境層（2026-08-09）。它只是「新頁的起點」與「歸位的目標」，
// 不追溯改動已存在的頁——那些頁各自的值仍存在自己的圖層上。
test('patientHome 沒寫時補全域預設', () => {
  const raw = [{ id: 'a', name: 'A', environment: '工地', medicalEvent: '外傷出血',
    slides: [{ id: 's1', title: 'a', layers: [{ type: 'scene' }] }] }];
  const { scenarios } = S.normalizeScenarios(raw, OPTIONS);
  assert.deepEqual(scenarios[0].patientHome, S.LAYER_DEFAULTS.patient);
});

test('patientHome 超出範圍的值被夾回來，缺的欄位補預設', () => {
  const raw = [{ id: 'a', name: 'A', environment: '工地', medicalEvent: '外傷出血',
    patientHome: { size: 999, x: -40 },
    slides: [{ id: 's1', title: 'a', layers: [{ type: 'scene' }] }] }];
  const { scenarios } = S.normalizeScenarios(raw, OPTIONS);
  assert.deepEqual(scenarios[0].patientHome,
    { size: S.LAYER_RANGES.size[1], x: S.LAYER_RANGES.x[0], y: S.LAYER_DEFAULTS.patient.y });
});

test('patientHome 不影響已存在的頁——那些頁的病患位置仍是自己的', () => {
  const raw = [{ id: 'a', name: 'A', environment: '工地', medicalEvent: '外傷出血',
    patientHome: { size: 30, x: 10, y: 20 },
    slides: [{ id: 's1', title: 'a', layers: [{ type: 'patient', size: 90, x: 60, y: 70 }] }] }];
  const { scenarios } = S.normalizeScenarios(raw, OPTIONS);
  const patient = S.layerOf(scenarios[0].slides[0], 'patient');
  assert.deepEqual({ size: patient.size, x: patient.x, y: patient.y }, { size: 90, x: 60, y: 70 });
});

test('patientHome 跟全域預設一樣就不匯出，改過才寫', () => {
  const base = { id: 'a', name: 'A', environment: '工地', medicalEvent: '外傷出血',
    slides: [{ id: 's1', title: 'a', layers: [{ type: 'scene' }] }] };
  const plain = S.normalizeScenarios([base], OPTIONS).scenarios;
  assert.equal('patientHome' in S.forExport(plain)[0], false);

  const moved = S.normalizeScenarios([{ ...base, patientHome: { size: 40, x: 20, y: 30 } }], OPTIONS).scenarios;
  assert.deepEqual(S.forExport(moved)[0].patientHome, { size: 40, x: 20, y: 30 });
});

test('patientHome 匯出後再匯入仍相同（round-trip）', () => {
  const raw = [{ id: 'a', name: 'A', environment: '工地', medicalEvent: '外傷出血',
    patientHome: { size: 44, x: 21, y: 33 },
    slides: [{ id: 's1', title: 'a', layers: [{ type: 'scene' }] }] }];
  const once = S.normalizeScenarios(raw, OPTIONS).scenarios;
  const twice = S.normalizeScenarios(S.forExport(once), OPTIONS).scenarios;
  assert.deepEqual(twice[0].patientHome, once[0].patientHome);
});

// 圖層顯示／隱藏（2026-08-09）。與「刪除」是兩件事：scene 與 patient 刪不掉，
// 所以「暫時只看場景」只能靠隱藏。
test('圖層預設是顯示的，visible 只有寫 false 才算隱藏', () => {
  const raw = [{ id: 'a', name: 'A', environment: '工地', medicalEvent: '外傷出血',
    slides: [{ id: 's1', title: 'a', layers: [
      { type: 'scene' },
      { type: 'patient', visible: false },
      { type: 'text', text: '止血', visible: true },
    ] }] }];
  const { scenarios } = S.normalizeScenarios(raw, OPTIONS);
  const slide = scenarios[0].slides[0];
  assert.equal(S.layerVisible(S.layerOf(slide, 'scene')), true, '沒寫就是顯示');
  assert.equal(S.layerVisible(S.layerOf(slide, 'patient')), false);
  assert.equal(S.layerVisible(S.layerOf(slide, 'text')), true);
  // visible: true 是預設值，不該被寫進正規化結果（否則匯出檔會被灌滿）
  assert.equal('visible' in S.layerOf(slide, 'text'), false);
});

test('隱藏的圖層匯出時才寫 visible，顯示的不寫', () => {
  const raw = [{ id: 'a', name: 'A', environment: '工地', medicalEvent: '外傷出血',
    slides: [{ id: 's1', title: 'a', layers: [
      { type: 'scene' }, { type: 'patient', visible: false },
    ] }] }];
  const out = S.forExport(S.normalizeScenarios(raw, OPTIONS).scenarios)[0];
  const layers = Object.fromEntries(out.slides[0].layers.map(l => [l.type, l]));
  assert.equal(layers.patient.visible, false);
  assert.equal('visible' in layers.scene, false);
});

test('layerVisible 對 null／undefined 回傳 false，不會炸', () => {
  assert.equal(S.layerVisible(null), false);
  assert.equal(S.layerVisible(undefined), false);
});

// ---------- 說明文字的定位模型 ----------
// 這幾條顧的是「預覽拖到哪，投影就在哪」。之前兩端各寫一套（預覽 top/left 是中心點，
// 投影卻是 left:0 + top:(y-50)%），拖起來對不上而且不會有任何地方報錯。
test('textBoxStyle 的 x/y 就是文字方塊的中心點，size/10 是字級百分比', () => {
  const style = S.textBoxStyle({ type: 'text', text: '止血', size: 40, x: 30, y: 80 }, 'vw');
  assert.deepEqual(style, { left: '30%', top: '80%', fontSize: '4vw' });
});

test('textBoxStyle 預覽與投影只差單位，數值必須一模一樣', () => {
  const layer = { type: 'text', text: '止血', size: 55, x: 25, y: 70 };
  const 預覽 = S.textBoxStyle(layer, 'cqw');
  const 投影 = S.textBoxStyle(layer, 'vw');
  assert.equal(預覽.left, 投影.left);
  assert.equal(預覽.top, 投影.top);
  assert.equal(預覽.fontSize.replace('cqw', ''), 投影.fontSize.replace('vw', ''));
});

test('textBoxStyle 遇到缺欄位的圖層回退到預設值，不會產出 NaN%', () => {
  const style = S.textBoxStyle({ type: 'text', text: '止血' }, 'vw');
  assert.deepEqual(style, { left: '50%', top: '50%', fontSize: '4vw' });
  assert.equal(S.textBoxStyle(null, 'vw'), null);
});

// sound 圖層在 2026-08-09 被移除（它從來沒有被播放過）。手改過 YAML 的人可能還存著
// 一份，所以「含 sound 的資料仍要能匯入成功、只是少那一層」比「乾淨地拒絕」重要——
// 那一層本來就不會發出聲音，丟掉不會讓人失去任何東西，但整份匯入失敗會。
test('已移除的 sound 圖層被安靜丟掉，不會讓整個情境失敗', () => {
  const raw = [{
    id: 'has-sound', name: '含聲音層', environment: '工地', medicalEvent: '外傷出血',
    slides: [{
      id: 's1', title: 'a',
      layers: [{ type: 'scene' }, { type: 'sound', asset: 'as001' }, { type: 'text', text: '止血' }],
    }],
  }];
  const { scenarios, warnings } = S.normalizeScenarios(raw, OPTIONS);
  assert.equal(scenarios.length, 1, '整個情境不該因為一個不支援的圖層而消失');
  const types = scenarios[0].slides[0].layers.map(l => l.type);
  assert.equal(types.includes('sound'), false, 'sound 圖層應該被丟掉');
  assert.deepEqual(types.filter(t => t !== 'patient').sort(), ['scene', 'text']);
  assert.match(warnings.join(''), /sound/, '要留下一則說明為什麼那層不見了');
});

test('sound 已不在支援的圖層型別內', () => {
  assert.equal(S.LAYER_TYPES.includes('sound'), false);
  assert.equal('sound' in S.LAYER_DEFAULTS, false);
});

test('id 重複時保留第一筆並警告', () => {
  const one = { id: 'dup', name: 'A', environment: '工地', medicalEvent: '外傷出血',
    slides: [{ id: 's1', title: 'a', layers: [{ type: 'scene' }] }] };
  const two = { ...one, name: 'B' };
  const { scenarios, warnings } = S.normalizeScenarios([one, two], OPTIONS);
  assert.equal(scenarios.length, 1);
  assert.equal(scenarios[0].name, 'A');
  assert.match(warnings.join(''), /重複/);
});

test('沒有任何有效圖層的頁會被丟掉；整個情境因此變空時整筆跳過', () => {
  const { scenarios, warnings } = S.normalizeScenarios([{
    id: 'x', name: 'x', environment: '工地', medicalEvent: '外傷出血',
    slides: [{ id: 's1', title: 'a', layers: [{ type: 'explode' }] }],
  }], OPTIONS);
  assert.deepEqual(scenarios, []);
  assert.match(warnings.join(''), /沒有任何有效簡報頁/);
});

// ---------- 內建 × 自訂 ----------

test('自訂情境覆蓋同 id 的內建，新的接在後面', () => {
  const builtin = [{ id: 'a', name: '內建A' }, { id: 'b', name: '內建B' }];
  const custom = [{ id: 'a', name: '改過的A' }, { id: 'c', name: '自訂C' }];
  const merged = S.mergeScenarios(builtin, custom);
  assert.deepEqual(merged.map(s => [s.id, s.name, s.source]), [
    ['a', '改過的A', 'overridden'],
    ['b', '內建B', 'builtin'],
    ['c', '自訂C', 'custom'],
  ]);
});

test('沒有自訂資料時就是純內建（清掉 localStorage 等於還原）', () => {
  const builtin = [{ id: 'a', name: '內建A' }];
  assert.deepEqual(S.mergeScenarios(builtin, []).map(s => s.name), ['內建A']);
  assert.deepEqual(S.mergeScenarios(builtin, null).map(s => s.name), ['內建A']);
});

// ---------- 匯出／匯入 ----------

test('匯出 → 匯入 → 再匯出，兩次輸出逐字相同', () => {
  const { scenarios } = S.normalizeScenarios(DATA.scenarios, OPTIONS);
  for (const s of scenarios) {
    const first = S.exportScenarioYaml(s, yaml.dump);
    const back = S.parseImport(first, OPTIONS, yaml.load);
    assert.equal(back.ok, true, s.id);
    assert.deepEqual(back.warnings, [], s.id);
    assert.equal(back.scenarios.length, 1);
    assert.equal(S.exportScenarioYaml(back.scenarios[0], yaml.dump), first, s.id);
  }
});

// 匯出檔要能原樣放進 scenarios/，所以它**不能**包 scenarios: 那一層——
// 包了的話貼進資料夾會變成一個 slides 為空的壞情境，而且是靜靜地壞。
test('匯出的 YAML 就是情境本身，沒有多包一層', () => {
  const { scenarios } = S.normalizeScenarios(DATA.scenarios, OPTIONS);
  const parsed = yaml.load(S.exportScenarioYaml(scenarios[0], yaml.dump));
  assert.equal('scenarios' in parsed, false);
  assert.equal(parsed.id, scenarios[0].id);
  assert.ok(Array.isArray(parsed.slides));
});

test('匯出檔不帶執行期欄位，且 enabled: true 不寫出來（保持最小差異）', () => {
  const merged = S.mergeScenarios(
    S.normalizeScenarios(DATA.scenarios, OPTIONS).scenarios, []);
  for (const s of merged) {
    const text = S.exportScenarioYaml(s, yaml.dump);
    assert.equal(text.includes('source:'), false, s.id);
    assert.equal(text.includes('enabled: true'), false, s.id);
  }
});

test('關掉的頁在匯出檔裡要寫出 enabled: false，往返才不會被打開', () => {
  const { scenarios } = S.normalizeScenarios([{
    id: 'x', name: 'x', environment: '工地', medicalEvent: '外傷出血',
    slides: [
      { id: 'a', title: 'a', layers: [{ type: 'scene' }] },
      { id: 'b', title: 'b', enabled: false, layers: [{ type: 'greenscreen', complication: '旁人嗆聲干擾' }] },
    ],
  }], OPTIONS);
  const text = S.exportScenarioYaml(scenarios[0], yaml.dump);
  assert.ok(text.includes('enabled: false'));
  const back = S.parseImport(text, OPTIONS, yaml.load);
  assert.equal(back.scenarios[0].slides[1].enabled, false);
});

// 匯入是「別人給你的檔」，所以三種形狀都要進得來：現在匯出的單一情境、
// 舊版整包匯出的 { scenarios: [...] }、以及手貼的純陣列。
test('匯入吃單一情境（scenarios/ 裡的檔直接丟進來就該認得）', () => {
  const text = fs.readFileSync(path.join(ROOT, 'scenarios', SCENARIO_FILES[0].file), 'utf8');
  const back = S.parseImport(text, OPTIONS, yaml.load);
  assert.equal(back.ok, true);
  assert.deepEqual(back.warnings, []);
  assert.equal(back.scenarios.length, 1);
  assert.equal(back.scenarios[0].id, SCENARIO_FILES[0].scenario.id);
});

test('匯入吃 JSON（JSON 是 YAML 的子集，同一個 parser 直接解得動）', () => {
  const { scenarios } = S.normalizeScenarios(DATA.scenarios, OPTIONS);
  const json = JSON.stringify({ scenarios: S.forExport(scenarios) });
  const back = S.parseImport(json, OPTIONS, yaml.load);
  assert.equal(back.ok, true);
  assert.equal(back.scenarios.length, 7);
  assert.deepEqual(back.warnings, []);
});

test('匯入吃「直接一個陣列」的檔案', () => {
  const { scenarios } = S.normalizeScenarios(DATA.scenarios, OPTIONS);
  const back = S.parseImport(JSON.stringify(S.forExport(scenarios)), OPTIONS, yaml.load);
  assert.equal(back.ok, true);
  assert.equal(back.scenarios.length, 7);
});

// ---------- 貢獻（COO-86）----------

test('貢獻 id 是 contrib-日期-亂數，且符合 id 規則（ASCII kebab-case）', () => {
  const id = S.contributionId(new Date(2026, 7, 10), () => 0.5);
  assert.match(id, /^contrib-20260810-[0-9a-z]{4}$/);
  assert.match(id, /^[a-z][a-z0-9-]*$/);
});

// 兩個教官各自貢獻不能撞成同一個檔名——本機 id 一律是 custom-1、custom-2，撞定了，
// 所以貢獻時一定要換一個。這條測的就是「真的換得開」。
test('貢獻 id 會隨亂數改變，不會兩個人撞同一個檔名', () => {
  const day = new Date(2026, 7, 10);
  const a = S.contributionId(day, () => 0.1);
  const b = S.contributionId(day, () => 0.9);
  assert.notEqual(a, b);
});

test('貢獻網址帶的檔名用貢獻 id，內容解回來就是那個情境', () => {
  const { scenarios } = S.normalizeScenarios(DATA.scenarios, OPTIONS);
  const scenario = { ...scenarios[0], id: 'contrib-20260810-abcd' };
  const url = S.contributionUrl(scenario,
    { repo: 'cooldongdong/ems-scene-player', branch: 'main', dump: yaml.dump });

  const parsed = new URL(url);
  assert.equal(parsed.origin + parsed.pathname, 'https://github.com/cooldongdong/ems-scene-player/new/main');
  assert.equal(parsed.searchParams.get('filename'), 'scenarios/contrib-20260810-abcd.yaml');

  const back = S.parseImport(parsed.searchParams.get('value'), OPTIONS, yaml.load);
  assert.equal(back.ok, true);
  assert.deepEqual(back.warnings, []);
  assert.equal(back.scenarios.length, 1);
  assert.equal(back.scenarios[0].id, 'contrib-20260810-abcd');
  assert.deepEqual(back.scenarios[0].slides, scenario.slides);
});

// 網址長度是這條路唯一的硬限制。內建裡最長的是 5 頁的路口車禍，實測約 2500 字元；
// 這條測試盯的是「別讓某次改動讓匯出突然變得很肥」，不是盯 GitHub 的上限。
test('內建情境的貢獻網址都遠低於長度上限', () => {
  const { scenarios } = S.normalizeScenarios(DATA.scenarios, OPTIONS);
  for (const s of scenarios) {
    const url = S.contributionUrl(s,
      { repo: 'cooldongdong/ems-scene-player', dump: yaml.dump });
    assert.ok(url.length < 6000, `情境「${s.id}」的貢獻網址 ${url.length} 字元，超過上限`);
  }
});

test('匯入壞檔案回報失敗，不丟例外', () => {
  const broken = S.parseImport('{{{ 這不是 yaml', OPTIONS, yaml.load);
  assert.equal(broken.ok, false);
  assert.match(broken.warnings.join(''), /解析失敗/);

  const noScenarios = S.parseImport('foo: bar', OPTIONS, yaml.load);
  assert.equal(noScenarios.ok, false);
  assert.match(noScenarios.warnings.join(''), /找不到情境/);
});

test('匯入的檔案裡有壞資料時，好的留下、壞的被跳過並警告', () => {
  const text = yaml.dump({
    scenarios: [
      { id: 'ok', name: '好的', environment: '工地', medicalEvent: '外傷出血',
        slides: [{ id: 's1', title: 'a', layers: [{ type: 'scene' }] }] },
      { id: 'ng', name: '壞的', environment: '火星', medicalEvent: '外傷出血',
        slides: [{ id: 's1', title: 'a', layers: [{ type: 'scene' }] }] },
    ],
  });
  const back = S.parseImport(text, OPTIONS, yaml.load);
  assert.equal(back.ok, true);
  assert.deepEqual(back.scenarios.map(s => s.id), ['ok']);
  assert.equal(back.warnings.length, 1);
});

// ---------- 素材比對與把關 ----------

test('沒寫 segment 的素材算第 1 段（多數素材都沒寫，回傳 undefined 會讓它們整批消失）', () => {
  assert.equal(S.segmentOf({ id: 'x' }), 1);
  assert.equal(S.segmentOf({ id: 'x', segment: 2 }), 2);
  assert.equal(S.segmentOf({ id: 'x', segment: '3' }), 3);
  assert.equal(S.segmentOf({ id: 'x', tags: { segment: 2 } }), 2);
  assert.equal(S.segmentOf({ id: 'x', segment: 0 }), 1);
  assert.equal(S.segmentOf({ id: 'x', segment: 'abc' }), 1);
});

test('特異性：標了範圍的維度越多分數越高，gender／ageGroup 不算', () => {
  assert.equal(S.specificity({ tags: {} }), 0);
  assert.equal(S.specificity({ tags: { environment: ['工地'] } }), 1);
  assert.equal(S.specificity({ tags: { environment: ['工地'], medicalEvent: ['外傷出血'] } }), 2);
  assert.equal(S.specificity({ tags: { environment: ['工地'], gender: ['male'], ageGroup: ['adult'] } }), 1);
});

test('專屬素材會贏過通用素材（市區街道＋車禍的路口照贏過任何路邊都能用的騎樓照）', () => {
  const picked = S.eligibleAssets(DATA.assets, 'environment_video',
    { env: '市區街道', med: '車禍多重傷' });
  assert.deepEqual(picked.map(a => a.id), ['ev004']);
});

test('沒勾突發狀況時，突發狀況素材一律不出現（不用通用素材頂替）', () => {
  assert.deepEqual(S.eligibleAssets(DATA.assets, 'complication_video',
    { env: '市區街道', med: '車禍多重傷', comps: [] }), []);
});

test('每個環境×急救事件實際可用的突發狀況數，與素材庫相符', () => {
  const 期望 = {
    '住宅客廳': [1, 1, 1, 1, 1, 2],
    '出租套房': [1, 1, 1, 1, 1, 2],
    'KTV 包廂': [1, 3, 1, 2, 3, 1],
    '市區街道': [2, 4, 2, 3, 3, 1],
    '工地': [1, 2, 1, 1, 1, 0],
  };
  for (const [env, counts] of Object.entries(期望)) {
    OPTIONS.medicalEvent.forEach((med, i) => {
      const n = S.availableComplications(DATA.assets, OPTIONS, env, med).filter(c => c.ok).length;
      assert.equal(n, counts[i], `${env}／${med} 應為 ${counts[i]} 個，實得 ${n}`);
    });
  }
});

test('工地＋自傷（割腕）一個突發狀況都沒有——六個都勾也不會有東西', () => {
  const usable = S.availableComplications(DATA.assets, OPTIONS, '工地', '自傷（割腕）')
    .filter(c => c.ok);
  assert.deepEqual(usable, []);
});

test('多片段的突發狀況會回報所有片段', () => {
  const a = S.complicationAvailability(DATA.assets, '肇事雙方爭吵', '市區街道', '車禍多重傷');
  assert.equal(a.ok, true);
  assert.deepEqual(a.segments, [1, 2, 3]);
});

test('沒有專屬配音不影響可用性（沒配音時會用綠幕影片的原聲）', () => {
  // 肇事雙方爭吵的第 2、3 段沒有專屬 complication_voice，但仍要算可用
  const voice2 = S.eligibleAssets(DATA.assets, 'complication_voice',
    { env: '市區街道', med: '車禍多重傷', comps: ['肇事雙方爭吵'], segment: 2 });
  assert.equal(voice2.length, 0, '前提：第 2 段確實沒有專屬配音');
  const a = S.complicationAvailability(DATA.assets, '肇事雙方爭吵', '市區街道', '車禍多重傷');
  assert.ok(a.segments.includes(2), '沒配音的片段仍應算可用');
});

test('基本四角色覆蓋：刻意留白（type: none）不算缺', () => {
  // 住宅客廳的環境聲音是 as003，type: none，那是資料作者的決定不是漏洞
  const home = S.baseCoverage(DATA.assets, '住宅客廳', '心跳停止（OHCA）');
  assert.equal(home.ambient_sound, 'none');
  assert.equal(home.environment_video, 'ok');
  assert.equal(home.patient_photo, 'ok');
});

test('基本四角色覆蓋：KTV 沒有環境影像、住宅客廳＋外傷沒有病患照片', () => {
  assert.equal(S.baseCoverage(DATA.assets, 'KTV 包廂', '酒醉意識不清').environment_video, 'missing');
  assert.equal(S.baseCoverage(DATA.assets, '住宅客廳', '外傷出血').patient_photo, 'missing');
});

test('覆蓋表：30 格中四項基本素材齊全的剛好 7 格', () => {
  const rows = S.coverageMatrix(DATA.assets, OPTIONS);
  assert.equal(rows.length, 30);
  const full = rows.filter(r => !r.missing.length);
  assert.equal(full.length, 7);
  assert.deepEqual(full.map(r => `${r.environment}／${r.medicalEvent}`), [
    '住宅客廳／心跳停止（OHCA）',
    '出租套房／自傷（割腕）',
    '市區街道／外傷出血',
    '市區街道／骨折（墜落）',
    '市區街道／車禍多重傷',
    '工地／外傷出血',
    '工地／骨折（墜落）',
  ]);
});

test('內建 7 組情境用到的突發狀況，在各自的環境×事件下全部可用', () => {
  const { scenarios } = S.normalizeScenarios(DATA.scenarios, OPTIONS);
  for (const s of scenarios) {
    for (const comp of S.complicationsOf(s)) {
      const a = S.complicationAvailability(DATA.assets, comp, s.environment, s.medicalEvent);
      assert.equal(a.ok, true, `${s.name} 的「${comp}」在 ${s.environment}／${s.medicalEvent} 沒有素材`);
    }
  }
});

// ---------- actions 模型 → 圖層模型的遷移 ----------
//
// 驗收只有一條：遷移前後，把情境從頭播到尾看到的東西一樣。
// 舊模型的「一個步驟」就是新模型的「一頁」，所以頁數必須等於步驟數。

// 複製 index.html 舊版 buildFlowSteps 的邏輯，作為遷移的對照組
function 舊模型的步驟(scenario, assets) {
  const out = [];
  for (const slide of (scenario.slides || []).filter(s => s.enabled !== false)) {
    for (const action of slide.actions || []) {
      if (action.type === 'wait') { out.push('wait'); continue; }
      if (action.type !== 'complication') continue;
      const segs = action.segment != null && action.segment !== ''
        ? [String(action.segment)]
        : S.complicationSegments(assets, action.complication, scenario.environment, scenario.medicalEvent).map(String);
      segs.forEach(sg => out.push(`${action.complication}#${sg}`));
    }
  }
  return out;
}

function 新模型的序列(scenario) {
  return S.playableSlides(scenario).map(slide => {
    const g = S.layerOf(slide, 'greenscreen');
    return g ? `${g.complication}#${g.segment || '1'}` : 'wait';
  });
}

const 舊格式的情境 = {
  id: 'x', name: '測試', environment: '市區街道', medicalEvent: '車禍多重傷',
  slides: [
    { id: 's1', title: '抵達現場', actions: [{ type: 'wait', note: '描述現場' }] },
    { id: 's2', title: '肇事雙方爭吵', actions: [{ type: 'complication', complication: '肇事雙方爭吵' }] },
    { id: 's3', title: '旁人插話', enabled: false, actions: [{ type: 'complication', complication: '旁人嗆聲干擾' }] },
  ],
};

test('遷移：播放序列逐步相同，頁數＝舊模型的步驟數', () => {
  const migrated = S.migrateScenario(舊格式的情境, DATA.assets, OPTIONS);
  const { scenarios, warnings } = S.normalizeScenarios([migrated], OPTIONS);
  assert.deepEqual(warnings, []);
  assert.deepEqual(新模型的序列(scenarios[0]), 舊模型的步驟(舊格式的情境, DATA.assets));
});

test('遷移：多片段的突發狀況展開成多頁，標題帶 (n/m)', () => {
  const migrated = S.migrateScenario(舊格式的情境, DATA.assets, OPTIONS);
  // 肇事雙方爭吵在市區街道＋車禍多重傷下有 3 段
  const titles = migrated.slides.map(s => s.title);
  assert.equal(titles.filter(t => t.startsWith('肇事雙方爭吵')).length, 3);
  assert.ok(titles.includes('肇事雙方爭吵（2/3）'), titles.join(' / '));
});

test('遷移：單片段不釘 segment（避免噪音），多片段才釘', () => {
  const migrated = S.migrateScenario(舊格式的情境, DATA.assets, OPTIONS);
  const many = migrated.slides.find(s => s.title === '肇事雙方爭吵（1/3）');
  const one = migrated.slides.find(s => s.title === '旁人插話');
  assert.equal(S.layerOf(many, 'greenscreen').segment, '1');
  assert.equal(S.layerOf(one, 'greenscreen').segment, undefined);
});

test('遷移：wait 的 note 變成 slide.note，不會變成投影出去的 text 圖層', () => {
  const migrated = S.migrateScenario(舊格式的情境, DATA.assets, OPTIONS);
  assert.equal(migrated.slides[0].note, '描述現場');
  assert.equal(S.layerOf(migrated.slides[0], 'text'), undefined);
});

test('遷移：關掉的頁展開後每一頁都仍是關閉', () => {
  const migrated = S.migrateScenario(舊格式的情境, DATA.assets, OPTIONS);
  const off = migrated.slides.filter(s => s.enabled === false);
  assert.equal(off.length, 1);
  assert.equal(off[0].title, '旁人插話');
});

test('遷移：每頁都補上 scene 與 patient 圖層', () => {
  const migrated = S.migrateScenario(舊格式的情境, DATA.assets, OPTIONS);
  for (const slide of migrated.slides) {
    assert.deepEqual(slide.layers.slice(0, 2).map(l => l.type), ['scene', 'patient']);
  }
});

test('遷移是冪等的：已經是圖層模型的資料再跑一次不會變', () => {
  const once = S.migrateScenario(舊格式的情境, DATA.assets, OPTIONS);
  const twice = S.migrateScenario(once, DATA.assets, OPTIONS);
  assert.deepEqual(twice, once);
});

test('遷移：scenarios/ 的檔已經是圖層模型，不含任何 actions', () => {
  assert.equal(JSON.stringify(DATA.scenarios).includes('"actions"'), false);
  for (const s of DATA.scenarios) {
    for (const slide of s.slides) assert.ok(Array.isArray(slide.layers), `${s.id}/${slide.id} 沒有 layers`);
  }
});

// ---------- 每頁必備的圖層 ----------

test('沒寫 scene／patient 的頁會自動補上——它們由情境決定，每頁都該有', () => {
  const { scenarios } = S.normalizeScenarios([{
    id: 'x', name: 'x', environment: '工地', medicalEvent: '外傷出血',
    slides: [{ id: 'a', title: 'a', layers: [{ type: 'text', text: '交班' }] }],
  }], OPTIONS);
  const slide = scenarios[0].slides[0];
  assert.deepEqual(slide.layers.map(l => l.type), ['scene', 'patient', 'text']);
  assert.equal(S.layerOf(slide, 'patient').size, S.LAYER_DEFAULTS.patient.size);
});

test('自動補上的圖層用預設值，且不會覆蓋作者自己寫的那一份', () => {
  const { scenarios } = S.normalizeScenarios([{
    id: 'x', name: 'x', environment: '工地', medicalEvent: '外傷出血',
    slides: [{ id: 'a', title: 'a', layers: [{ type: 'patient', size: 30, x: 20 }] }],
  }], OPTIONS);
  const slide = scenarios[0].slides[0];
  assert.equal(S.layerOf(slide, 'patient').size, 30, '作者寫的值要留著');
  assert.ok(S.layerOf(slide, 'scene'), 'scene 要被補上');
});

test('內建 7 組情境的每一頁都有 scene 與 patient', () => {
  const { scenarios } = S.normalizeScenarios(DATA.scenarios, OPTIONS);
  for (const s of scenarios) {
    for (const slide of s.slides) {
      for (const type of S.ALWAYS_ON_LAYERS) {
        assert.ok(S.layerOf(slide, type), `${s.id}/${slide.id} 缺 ${type}`);
      }
    }
  }
});
