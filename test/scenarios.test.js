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

const ROOT = path.join(__dirname, '..');
const DATA = yaml.load(fs.readFileSync(path.join(ROOT, 'scenario-data.yaml'), 'utf8'));
const OPTIONS = DATA.options;

// ---------- 真實資料 ----------

test('scenario-data.yaml 的 7 組情境全部通過正規化，零警告', () => {
  const { scenarios, warnings } = S.normalizeScenarios(DATA.scenarios, OPTIONS);
  assert.deepEqual(warnings, []);
  assert.equal(scenarios.length, 7);
});

test('舊的 presets 鍵已經完全移除，不留相容層', () => {
  assert.equal('presets' in DATA, false);
  assert.ok(Array.isArray(DATA.scenarios));
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
  const first = S.exportYaml(scenarios, yaml.dump);
  const back = S.parseImport(first, OPTIONS, yaml.load);
  assert.equal(back.ok, true);
  assert.deepEqual(back.warnings, []);
  const second = S.exportYaml(back.scenarios, yaml.dump);
  assert.equal(second, first);
});

test('匯出的 YAML 可以被 jsyaml 解析，結構是 { scenarios: [...] }', () => {
  const { scenarios } = S.normalizeScenarios(DATA.scenarios, OPTIONS);
  const parsed = yaml.load(S.exportYaml(scenarios, yaml.dump));
  assert.ok(Array.isArray(parsed.scenarios));
  assert.equal(parsed.scenarios.length, 7);
});

test('匯出檔不帶執行期欄位，且 enabled: true 不寫出來（保持最小差異）', () => {
  const merged = S.mergeScenarios(
    S.normalizeScenarios(DATA.scenarios, OPTIONS).scenarios, []);
  const text = S.exportYaml(merged, yaml.dump);
  assert.equal(text.includes('source:'), false);
  assert.equal(text.includes('enabled: true'), false);
});

test('關掉的頁在匯出檔裡要寫出 enabled: false，往返才不會被打開', () => {
  const { scenarios } = S.normalizeScenarios([{
    id: 'x', name: 'x', environment: '工地', medicalEvent: '外傷出血',
    slides: [
      { id: 'a', title: 'a', layers: [{ type: 'scene' }] },
      { id: 'b', title: 'b', enabled: false, layers: [{ type: 'greenscreen', complication: '旁人嗆聲干擾' }] },
    ],
  }], OPTIONS);
  const text = S.exportYaml(scenarios, yaml.dump);
  assert.ok(text.includes('enabled: false'));
  const back = S.parseImport(text, OPTIONS, yaml.load);
  assert.equal(back.scenarios[0].slides[1].enabled, false);
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

test('匯入壞檔案回報失敗，不丟例外', () => {
  const broken = S.parseImport('{{{ 這不是 yaml', OPTIONS, yaml.load);
  assert.equal(broken.ok, false);
  assert.match(broken.warnings.join(''), /解析失敗/);

  const noScenarios = S.parseImport('foo: bar', OPTIONS, yaml.load);
  assert.equal(noScenarios.ok, false);
  assert.match(noScenarios.warnings.join(''), /找不到 scenarios/);
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

test('遷移：scenario-data.yaml 已經是圖層模型，不含任何 actions', () => {
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
