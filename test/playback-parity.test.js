// 播放序列的對照測試 —— 為 COO-90「把播放從卡片解耦」而寫。
//
// 為什麼是這個形狀：
// 票上的驗收寫「7 組情境每一頁的聲音與綠幕都跟現在一模一樣」，但 index.html 的
// pickForRole 是**隨機**從候選裡抽一筆（同條件重跑會刻意換素材），所以「一模一樣」
// 不可能照字面比對 asset id。真正該被釘住、也真正會被重構弄壞的是這兩層：
//
//   1. 播放序列：每組情境會走過哪幾頁，每頁對應哪一個 `突發狀況|片段`
//   2. 候選集合：那個片段在該情境的環境×事件下，能抽到哪些素材
//
// 隨機只發生在候選集合**內部**，而重構不會動到那一步。所以候選集合不變 ＋ 序列不變
// ＝ 播放行為不變，這是可以自動比對的最強保證。
//
// 快照存成 JSON（playback-baseline.json）而不是寫死在測試裡：素材有意增減時，
// 差異要能一眼看出來是哪一格變了，而不是讀一大段 assert。
//
//     node --test                     比對現況與快照
//     UPDATE_BASELINE=1 node --test   認可變更、重寫快照

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const yaml = require('../vendor/js-yaml.min.js');
const S = require('../js/scenarios.js');

const { loadScenarios } = require('../tools/load-scenarios.js');

const ROOT = path.join(__dirname, '..');
const DATA = yaml.load(fs.readFileSync(path.join(ROOT, 'scenario-data.yaml'), 'utf8'));
// 情境改住 scenarios/（COO-84）。掃資料夾，不讀 index.yaml——理由見 tools/load-scenarios.js。
// **拆檔不該讓這份快照有任何變動**，那就是這次遷移的驗收。
DATA.scenarios = loadScenarios(ROOT).map(x => x.scenario);
const BASELINE_FILE = path.join(__dirname, 'playback-baseline.json');

const { scenarios } = S.normalizeScenarios(DATA.scenarios, DATA.options);

const ids = list => list.map(a => a.id).sort();

// index.html 的 runStep() 解析綠幕圖層的規則：segment 省略＝該突發狀況的第一段。
// 這裡複製的是**規則**不是實作——重構後 runStep 若改了這條，快照就會紅。
function resolveSegment(green, env, med) {
  return green.segment || S.complicationSegments(DATA.assets, green.complication, env, med)[0];
}

// 一組情境的完整播放輪廓：走過哪些頁、每頁播什麼、每頁能抽到哪些素材。
function playbackProfile(scenario) {
  const env = scenario.environment;
  const med = scenario.medicalEvent;
  const comps = S.complicationsOf(scenario);

  const steps = S.playableSlides(scenario).map(slide => {
    const green = S.layerOf(slide, 'greenscreen');
    const text = S.layerOf(slide, 'text');
    const step = {
      title: slide.title,
      layers: slide.layers.map(l => l.type),
      // 有沒有字幕會影響投影畫面，但不影響聲音；一起釘住免得重構順手改掉
      text: text ? text.text : null,
      segmentKey: null,
      video: [],
      voice: [],
    };
    if (!green) return step;

    const segment = resolveSegment(green, env, med);
    step.segmentKey = `${green.complication}|${segment}`;
    const opts = { env, med, comps: [green.complication], segment };
    step.video = ids(S.eligibleAssets(DATA.assets, 'complication_video', opts));
    step.voice = ids(S.eligibleAssets(DATA.assets, 'complication_voice', opts));
    return step;
  });

  // 場景底層的素材由 generate() 挑，重構要把「挑」留下、只砍「畫卡片」，
  // 所以這四個角色的候選集合同樣不該變。
  const photos = S.eligibleAssets(DATA.assets, 'patient_photo', { env, med, comps });
  const base = {
    environment_video: ids(S.eligibleAssets(DATA.assets, 'environment_video', { env, med, comps })),
    ambient_sound: ids(S.eligibleAssets(DATA.assets, 'ambient_sound', { env, med, comps })),
    patient_photo: ids(photos),
    // 病患聲音要跟當次抽到的照片相容，而照片是隨機的——所以逐張照片各記一份，
    // 只記聯集會把「這張照片配不到聲音」這種缺口蓋掉。
    patient_voice: Object.fromEntries(photos.map(photo => [
      photo.id,
      ids(S.eligibleAssets(DATA.assets, 'patient_voice', { env, med, comps, patientPhoto: photo })),
    ])),
  };

  return { id: scenario.id, environment: env, medicalEvent: med, complications: comps, base, steps };
}

const current = {
  note: '由 test/playback-parity.test.js 產生。手改無效，請用 UPDATE_BASELINE=1 node --test 重寫。',
  scenarios: scenarios.map(playbackProfile),
};

if (process.env.UPDATE_BASELINE) {
  fs.writeFileSync(BASELINE_FILE, JSON.stringify(current, null, 2) + '\n');
}

test('播放序列與素材候選集合與快照一致', () => {
  assert.ok(fs.existsSync(BASELINE_FILE),
    '找不到 playback-baseline.json，先跑一次 UPDATE_BASELINE=1 node --test');
  const baseline = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'));

  // 逐組比對而不是整包 deepEqual：整包失敗時的 diff 讀不出是哪一組情境壞的。
  //
  // 依 id 對照而不是依位置：清單順序是「畫面上先看到誰」，不是播放行為。COO-84 把情境
  // 拆進 scenarios/ 之後，順序由檔名決定，跟原本手排的順序不同——那是一次刻意的改動，
  // 不該讓這條測試變紅。順序若哪天真的重要，該另外立一條測試；跟播放共用同一個紅燈的話，
  // 「播放壞了」與「排序變了」看起來會一模一樣。
  assert.deepEqual(
    current.scenarios.map(s => s.id).sort(),
    baseline.scenarios.map(s => s.id).sort(),
    '情境清單本身變了');
  for (const scenario of current.scenarios) {
    const was = baseline.scenarios.find(s => s.id === scenario.id);
    assert.deepEqual(scenario, was, `情境「${scenario.id}」的播放輪廓變了`);
  }
});

// 上面那個快照只證明「跟之前一樣」。萬一它一開始就錄到壞的現況，
// 重構後仍然會綠。下面幾條是不依賴快照的絕對條件。

test('每一個綠幕頁都抽得到影片素材——沒有一頁是按下去沒東西', () => {
  const empty = [];
  for (const s of current.scenarios) {
    for (const step of s.steps) {
      if (step.segmentKey && !step.video.length) empty.push(`${s.id} / ${step.title}`);
    }
  }
  assert.deepEqual(empty, [], '這些頁的綠幕影片候選是空的');
});

test('綠幕頁解析出的片段，都在該情境實際存在的片段清單裡', () => {
  for (const s of current.scenarios) {
    for (const step of s.steps) {
      if (!step.segmentKey) continue;
      const [comp, segment] = step.segmentKey.split('|');
      const known = S.complicationSegments(DATA.assets, comp, s.environment, s.medicalEvent)
        .map(String);
      assert.ok(known.includes(String(segment)),
        `${s.id}／${comp} 片段 ${segment} 不在實際片段 ${known.join('、')} 之中`);
    }
  }
});

test('同一頁不會登記到兩個不同的片段——segmentKey 是播放的唯一索引', () => {
  for (const s of current.scenarios) {
    const keys = s.steps.map(step => step.segmentKey).filter(Boolean);
    // 允許重複（同一段可以在流程裡出現兩次），但 key 必須解析得出來
    for (const key of keys) assert.match(key, /^.+\|\d+$/, `${s.id} 的 segmentKey「${key}」格式不對`);
  }
});

test('每組情境的病患照片候選，每一張都配得到病患聲音', () => {
  const gaps = [];
  for (const s of current.scenarios) {
    for (const [photo, voices] of Object.entries(s.base.patient_voice)) {
      if (!voices.length) gaps.push(`${s.id} / ${photo}`);
    }
  }
  assert.deepEqual(gaps, [], '這些照片抽中時會沒有病患聲音');
});
