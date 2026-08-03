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

test('每個情境至少有一頁，且第一頁是 wait（流程要有起點）', () => {
  const { scenarios } = S.normalizeScenarios(DATA.scenarios, OPTIONS);
  for (const s of scenarios) {
    assert.ok(s.slides.length >= 1, `${s.name} 沒有簡報頁`);
    assert.equal(s.slides[0].actions[0].type, 'wait', `${s.name} 第一頁不是 wait`);
  }
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
      { id: 'a', title: 'a', enabled: true, actions: [{ type: 'complication', complication: '旁人嗆聲干擾' }] },
      { id: 'b', title: 'b', enabled: false, actions: [{ type: 'complication', complication: '同事欲搬動傷患' }] },
    ],
  };
  assert.deepEqual(S.complicationsOf(scenario), ['旁人嗆聲干擾']);
  assert.deepEqual(S.playableSlides(scenario).map(s => s.id), ['a']);
});

test('關掉的頁仍留在清單裡（是跳過，不是刪除）', () => {
  const { scenarios } = S.normalizeScenarios([{
    id: 'x', name: 'x', environment: '工地', medicalEvent: '外傷出血',
    slides: [
      { id: 'a', title: 'a', actions: [{ type: 'wait' }] },
      { id: 'b', title: 'b', enabled: false, actions: [{ type: 'complication', complication: '旁人嗆聲干擾' }] },
    ],
  }], OPTIONS);
  assert.equal(scenarios[0].slides.length, 2);
  assert.equal(scenarios[0].slides[1].enabled, false);
});

test('同一個突發狀況出現在多頁時，推導結果只算一次且保留首次出現的順序', () => {
  const scenario = {
    slides: [
      { actions: [{ type: 'complication', complication: '旁人嗆聲干擾' }] },
      { actions: [{ type: 'complication', complication: '同事欲搬動傷患' }] },
      { actions: [{ type: 'complication', complication: '旁人嗆聲干擾' }] },
    ],
  };
  assert.deepEqual(S.complicationsOf(scenario), ['旁人嗆聲干擾', '同事欲搬動傷患']);
});

test('enabled 省略時視為啟用', () => {
  const { scenarios } = S.normalizeScenarios([{
    id: 'x', name: 'x', environment: '工地', medicalEvent: '外傷出血',
    slides: [{ id: 'a', title: 'a', actions: [{ type: 'wait' }] }],
  }], OPTIONS);
  assert.equal(scenarios[0].slides[0].enabled, true);
});

// ---------- 壞資料 ----------

test('壞資料被跳過並留警告，不會讓整份載入失敗', () => {
  const raw = [
    { id: 'good', name: '好的', environment: '工地', medicalEvent: '外傷出血',
      slides: [{ id: 's1', title: 'a', actions: [{ type: 'wait' }] }] },
    { id: 'bad-env', name: '壞環境', environment: '不存在的環境', medicalEvent: '外傷出血',
      slides: [{ id: 's1', title: 'a', actions: [{ type: 'wait' }] }] },
    { id: 'bad-med', name: '壞事件', environment: '工地', medicalEvent: '不存在的事件',
      slides: [{ id: 's1', title: 'a', actions: [{ type: 'wait' }] }] },
    { id: 'no-slides', name: '空流程', environment: '工地', medicalEvent: '外傷出血', slides: [] },
    { id: 'bad-comp', name: '壞狀況', environment: '工地', medicalEvent: '外傷出血',
      slides: [{ id: 's1', title: 'a', actions: [{ type: 'complication', complication: '沒這個狀況' }] }] },
    { id: 'bad-type', name: '壞型別', environment: '工地', medicalEvent: '外傷出血',
      slides: [{ id: 's1', title: 'a', actions: [{ type: 'explode' }] }] },
  ];
  const { scenarios, warnings } = S.normalizeScenarios(raw, OPTIONS);
  assert.deepEqual(scenarios.map(s => s.id), ['good']);
  assert.equal(warnings.length >= 5, true, `警告太少：${warnings.length}`);
});

test('id 重複時保留第一筆並警告', () => {
  const one = { id: 'dup', name: 'A', environment: '工地', medicalEvent: '外傷出血',
    slides: [{ id: 's1', title: 'a', actions: [{ type: 'wait' }] }] };
  const two = { ...one, name: 'B' };
  const { scenarios, warnings } = S.normalizeScenarios([one, two], OPTIONS);
  assert.equal(scenarios.length, 1);
  assert.equal(scenarios[0].name, 'A');
  assert.match(warnings.join(''), /重複/);
});

test('沒有任何有效動作的頁會被丟掉；整個情境因此變空時整筆跳過', () => {
  const { scenarios, warnings } = S.normalizeScenarios([{
    id: 'x', name: 'x', environment: '工地', medicalEvent: '外傷出血',
    slides: [{ id: 's1', title: 'a', actions: [{ type: 'explode' }] }],
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
      { id: 'a', title: 'a', actions: [{ type: 'wait' }] },
      { id: 'b', title: 'b', enabled: false, actions: [{ type: 'complication', complication: '旁人嗆聲干擾' }] },
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
        slides: [{ id: 's1', title: 'a', actions: [{ type: 'wait' }] }] },
      { id: 'ng', name: '壞的', environment: '火星', medicalEvent: '外傷出血',
        slides: [{ id: 's1', title: 'a', actions: [{ type: 'wait' }] }] },
    ],
  });
  const back = S.parseImport(text, OPTIONS, yaml.load);
  assert.equal(back.ok, true);
  assert.deepEqual(back.scenarios.map(s => s.id), ['ok']);
  assert.equal(back.warnings.length, 1);
});

// ---------- preset 遷移函式 ----------

test('fromPreset 轉出的情境，推導出的突發狀況與原 preset 相同', () => {
  const preset = { name: '測試', environment: '工地', medicalEvent: '外傷出血',
    complications: ['旁人嗆聲干擾', '同事欲搬動傷患'], note: '說明' };
  const scenario = S.fromPreset(preset);
  assert.deepEqual(S.complicationsOf(scenario), preset.complications);
  assert.equal(scenario.slides.length, 3);   // wait 起點 ＋ 兩個突發狀況
});

test('沒有突發狀況的 preset 轉出來仍有一頁 wait，不會變成空流程', () => {
  const scenario = S.fromPreset({ name: '純環境', environment: '工地', medicalEvent: '外傷出血' });
  assert.equal(scenario.slides.length, 1);
  assert.deepEqual(S.complicationsOf(scenario), []);
  const { scenarios, warnings } = S.normalizeScenarios([scenario], OPTIONS);
  assert.equal(scenarios.length, 1, warnings.join(''));
});
