// 情境資料層 —— 純函式，不碰 DOM、不碰 localStorage、不引用 jsyaml。
//
// 為什麼獨立成一個檔：這一層錯了，上面的播放與編輯都要重做，所以它必須能被測試釘住。
// 但這個專案沒有 build、沒有 package.json，所以寫成同時吃兩種載入方式：
//   瀏覽器 <script src="js/scenarios.js">  →  globalThis.Scenarios
//   Node   require('./js/scenarios.js')     →  module.exports
// 兩邊拿到的是同一份物件，測試跑的就是瀏覽器實際執行的那份程式碼。
//
// 需要外部能力的地方一律用參數注入（yaml dump/load、storage），不在這裡 import——
// 這樣測試不必準備瀏覽器環境，也不必 mock 全域。

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Scenarios = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // 動作型別刻意只有兩種。要加第三種之前，先跑過一輪真實訓練再說——
  // 通用腳本引擎很好寫，但沒有人知道教官實際需要哪些動作。
  const ACTION_TYPES = ['complication', 'wait'];

  const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);
  const asArray = v => (Array.isArray(v) ? v : v == null ? [] : [v]);
  const trimmed = v => (typeof v === 'string' ? v.trim() : '');

  // options.environment 在 YAML 是「室內／室外」分組物件，也可能是舊的平鋪陣列
  function flattenEnvironments(declared) {
    if (Array.isArray(declared)) return declared.slice();
    if (isObject(declared)) {
      return Object.values(declared).filter(Array.isArray).flat();
    }
    return [];
  }

  function optionSets(options) {
    const o = options || {};
    return {
      environments: flattenEnvironments(o.environment),
      medicalEvents: asArray(o.medicalEvent),
      complications: asArray(o.complication),
    };
  }

  // ---------- 推導 ----------

  // 情境用到哪些突發狀況 = 所有「啟用中」的簡報頁引用到的聯集。
  // 不另外存欄位：存了就是第二份真相，遲早出現「勾了但沒有任何一頁用到」的矛盾。
  function complicationsOf(scenario) {
    const seen = [];
    for (const slide of asArray(scenario && scenario.slides)) {
      if (slide.enabled === false) continue;
      for (const action of asArray(slide.actions)) {
        if (action && action.type === 'complication' && action.complication
            && !seen.includes(action.complication)) {
          seen.push(action.complication);
        }
      }
    }
    return seen;
  }

  // 播放時實際會走到的頁；enabled === false 的頁跳過，但仍留在清單裡供人打開
  function playableSlides(scenario) {
    return asArray(scenario && scenario.slides).filter(s => s.enabled !== false);
  }

  // ---------- 驗證與正規化 ----------

  function normalizeAction(action, sets, where, warn) {
    if (!isObject(action)) {
      warn(`${where} 的動作不是物件，已跳過`);
      return null;
    }
    const type = trimmed(action.type);
    if (!ACTION_TYPES.includes(type)) {
      warn(`${where} 的動作型別「${action.type}」不支援（只有 ${ACTION_TYPES.join('／')}），已跳過`);
      return null;
    }
    if (type === 'wait') {
      const out = { type: 'wait' };
      if (trimmed(action.note)) out.note = trimmed(action.note);
      return out;
    }
    const comp = trimmed(action.complication);
    if (!comp) {
      warn(`${where} 的 complication 動作沒有指定突發狀況，已跳過`);
      return null;
    }
    if (sets.complications.length && !sets.complications.includes(comp)) {
      warn(`${where} 的突發狀況「${comp}」不在 options 內，已跳過`);
      return null;
    }
    const out = { type: 'complication', complication: comp };
    // segment 省略 = 播該狀況的全部片段；填了就只播那一段
    if (action.segment !== undefined && action.segment !== null && action.segment !== '') {
      out.segment = String(action.segment);
    }
    return out;
  }

  function normalizeSlide(slide, index, sets, where, warn) {
    if (!isObject(slide)) {
      warn(`${where} 第 ${index + 1} 頁不是物件，已跳過`);
      return null;
    }
    const id = trimmed(slide.id) || `s${index + 1}`;
    const label = `${where} 第 ${index + 1} 頁（${trimmed(slide.title) || id}）`;
    const actions = asArray(slide.actions)
      .map(a => normalizeAction(a, sets, label, warn))
      .filter(Boolean);
    if (!actions.length) {
      warn(`${label} 沒有任何有效動作，已跳過`);
      return null;
    }
    return {
      id,
      title: trimmed(slide.title) || `第 ${index + 1} 頁`,
      // 只有明確寫 false 才是關閉；沒寫視為啟用，這樣手寫 YAML 不必每頁都補 enabled
      enabled: slide.enabled !== false,
      actions,
    };
  }

  // 值對不上 options 的情境整筆跳過：與其載入一半讓人以為選好了，不如當它不存在。
  function normalizeScenario(scenario, index, sets, warn) {
    if (!isObject(scenario)) {
      warn(`第 ${index + 1} 筆情境不是物件，已跳過`);
      return null;
    }
    const name = trimmed(scenario.name);
    const id = trimmed(scenario.id) || name;
    const where = `情境「${name || id || index + 1}」`;

    if (!id) {
      warn(`第 ${index + 1} 筆情境沒有 id 也沒有 name，已跳過`);
      return null;
    }
    const env = trimmed(scenario.environment);
    const med = trimmed(scenario.medicalEvent);
    const bad = [];
    if (sets.environments.length && !sets.environments.includes(env)) {
      bad.push(`environment「${scenario.environment}」`);
    }
    if (sets.medicalEvents.length && !sets.medicalEvents.includes(med)) {
      bad.push(`medicalEvent「${scenario.medicalEvent}」`);
    }
    if (bad.length) {
      warn(`${where} 的 ${bad.join('、')} 不在 options 內，已跳過`);
      return null;
    }

    const slides = asArray(scenario.slides)
      .map((s, i) => normalizeSlide(s, i, sets, where, warn))
      .filter(Boolean);
    if (!slides.length) {
      // 空流程的情境載入後是一片空白，比不存在更難懂
      warn(`${where} 沒有任何有效簡報頁，已跳過`);
      return null;
    }

    const out = { id, name: name || id, environment: env, medicalEvent: med, slides };
    if (trimmed(scenario.note)) out.note = trimmed(scenario.note);
    return out;
  }

  /**
   * 把原始 scenarios 陣列正規化成可用的清單。
   * @returns {{ scenarios: Array, warnings: string[] }}
   */
  function normalizeScenarios(raw, options) {
    const sets = optionSets(options);
    const warnings = [];
    const warn = msg => warnings.push(msg);
    const seenIds = new Set();
    const scenarios = [];

    for (const [i, item] of asArray(raw).entries()) {
      const s = normalizeScenario(item, i, sets, warn);
      if (!s) continue;
      if (seenIds.has(s.id)) {
        warn(`情境 id「${s.id}」重複，後面這筆已跳過`);
        continue;
      }
      seenIds.add(s.id);
      scenarios.push(s);
    }
    return { scenarios, warnings };
  }

  // ---------- 內建 × 自訂 ----------

  /**
   * 自訂情境覆蓋同 id 的內建情境；新的自訂情境接在後面，順序穩定。
   * 清掉自訂資料就會回到純內建的狀態——這是「還原」的實作方式。
   */
  function mergeScenarios(builtin, custom) {
    const byId = new Map();
    for (const s of asArray(builtin)) byId.set(s.id, { ...s, source: 'builtin' });
    for (const s of asArray(custom)) {
      byId.set(s.id, { ...s, source: byId.has(s.id) ? 'overridden' : 'custom' });
    }
    return [...byId.values()];
  }

  // ---------- 匯出／匯入 ----------

  // 匯出前把執行期才有的欄位（source）拿掉，否則匯出檔會帶著上一台機器的來源標記
  function forExport(scenarios) {
    return asArray(scenarios).map(s => {
      const out = { id: s.id, name: s.name, environment: s.environment, medicalEvent: s.medicalEvent };
      if (s.note) out.note = s.note;
      out.slides = asArray(s.slides).map(slide => {
        const o = { id: slide.id, title: slide.title };
        // enabled: true 是預設值，不寫進匯出檔，讓人手改時看到的是最小差異
        if (slide.enabled === false) o.enabled = false;
        o.actions = asArray(slide.actions).map(a => ({ ...a }));
        return o;
      });
      return out;
    });
  }

  /**
   * 匯出成可直接貼回 scenario-data.yaml 的文字。
   * @param dump 由呼叫端注入的 jsyaml.dump，這一層不綁任何 yaml 實作
   */
  function exportYaml(scenarios, dump) {
    return dump({ scenarios: forExport(scenarios) }, { lineWidth: -1, noRefs: true });
  }

  /**
   * 匯入。YAML 與 JSON 都吃——JSON 是 YAML 的子集，同一個 parser 直接解得動，
   * 所以「兩種格式都支援」的成本是零，不需要先猜格式。
   * @param load 由呼叫端注入的 jsyaml.load
   */
  function parseImport(text, options, load) {
    let data;
    try {
      data = load(text);
    } catch (err) {
      return { scenarios: [], warnings: [`檔案解析失敗：${err.message}`], ok: false };
    }
    // 接受 { scenarios: [...] } 或直接一個陣列
    const raw = Array.isArray(data) ? data : (isObject(data) ? data.scenarios : null);
    if (!raw) {
      return { scenarios: [], warnings: ['檔案裡找不到 scenarios 陣列'], ok: false };
    }
    const result = normalizeScenarios(raw, options);
    return { ...result, ok: true };
  }

  // ---------- 舊 preset 遷移 ----------

  /**
   * 把舊的 preset（環境＋事件＋一組突發狀況）轉成情境：每個突發狀況各成一頁，
   * 順序照原本的陣列順序。轉完的情境推導出的突發狀況集合與原本的 complications 相同。
   * 前面補一頁 wait，因為原本的 preset 沒有「抵達現場」這個起點，而流程需要一個開頭。
   */
  function fromPreset(preset) {
    const comps = asArray(preset.complications || preset.complication);
    const slides = [{
      id: 's1',
      title: '抵達現場',
      enabled: true,
      actions: [{ type: 'wait', note: preset.note || '教官描述現場、指派任務' }],
    }];
    comps.forEach((comp, i) => {
      slides.push({
        id: `s${i + 2}`,
        title: comp,
        enabled: true,
        actions: [{ type: 'complication', complication: comp }],
      });
    });
    const out = {
      id: preset.id || preset.name,
      name: preset.name,
      environment: preset.environment,
      medicalEvent: preset.medicalEvent,
      slides,
    };
    if (preset.note) out.note = preset.note;
    return out;
  }

  // ---------- 素材比對 ----------
  // 這一段是從 index.html 的 pickForRole 搬過來的。搬的理由：
  // 「這個選項能不能用」與「實際挑哪一筆素材」必須是同一份實作，
  // 各寫一份的話，畫面上說能用、按下去卻沒東西，兩邊還都覺得自己沒錯。
  // 隨機挑選與「上次挑過什麼」留在 index.html——那是每次執行才有的狀態，不是判斷。

  const COMPLICATION_ROLES = ['complication_video', 'complication_voice'];
  const BASE_ROLES = ['environment_video', 'ambient_sound', 'patient_photo', 'patient_voice'];
  // 特異性只看這三個維度；gender／ageGroup 是配對條件，不是精準度
  const SPECIFICITY_TAGS = ['environment', 'medicalEvent', 'complication'];
  const VISUAL_EXT = /\.(mp4|webm|mov|m4v|ogv|jpg|jpeg|png|gif|webp|svg|avif)$/i;

  const tagsOf = a => (a && a.tags) || {};
  const allows = (list, picked) => !list || list.length === 0 || list.includes(picked);
  const hits = (list, picks) => (list || []).some(v => picks.includes(v));

  function specificity(asset) {
    return SPECIFICITY_TAGS.reduce((n, dim) => n + ((tagsOf(asset)[dim] || []).length ? 1 : 0), 0);
  }

  // 素材沒寫 segment 就是第 1 段——多數素材都沒寫，回傳 undefined 會讓它們
  // 在依片段篩選時整批消失，而且是靜靜地消失。
  function segmentOf(asset) {
    const value = Number(asset && (tagsOf(asset).segment ?? asset.segment));
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 1;
  }

  function firstFile(asset) {
    const f = asset && asset.file;
    const one = Array.isArray(f) ? f[0] : f;
    return typeof one === 'string' ? one : null;
  }

  // 病患聲音要跟本次選到的照片性別、年齡層相容；空標籤代表通用
  function patientCompatible(asset, patientPhoto) {
    if (!patientPhoto) return true;
    return ['gender', 'ageGroup'].every(tag => {
      const cand = tagsOf(asset)[tag] || [];
      const sel = tagsOf(patientPhoto)[tag] || [];
      return !cand.length || !sel.length || hits(cand, sel);
    });
  }

  /**
   * 某個 role 在這組條件下「還剩哪些素材可選」（已做完特異性篩選）。
   * 回傳空陣列＝這格是空的，UI 該把它擋下來或標出來。
   */
  function eligibleAssets(assets, role, { env, med, comps = [], patientPhoto = null, segment = null } = {}) {
    let list = (assets || []).filter(a => a.role === role
      && (segment === null || String(segmentOf(a)) === String(segment)));
    list = list.filter(a => allows(tagsOf(a).environment, env) && allows(tagsOf(a).medicalEvent, med));
    if (role === 'patient_voice') list = list.filter(a => patientCompatible(a, patientPhoto));
    // 綁定特定突發狀況的素材，只有在該狀況被勾選時才可用
    list = list.filter(a => {
      const c = tagsOf(a).complication || [];
      return !c.length || hits(c, comps);
    });
    if (COMPLICATION_ROLES.includes(role)) {
      list = comps.length ? list.filter(a => hits(tagsOf(a).complication, comps)) : [];
    }
    if (!list.length) return [];
    // 標籤填得越精準的越優先，通用素材只在沒有專屬素材時頂替
    const best = Math.max(...list.map(specificity));
    return list.filter(a => specificity(a) === best);
  }

  // 綠幕人物疊得上去的條件：不是 type:none，而且第一個檔是影片或圖片。
  // 配音是選配——沒有專屬配音時會用綠幕影片的原聲，那仍然是可用的。
  function projectableComplication(asset) {
    if (!asset || asset.type === 'none') return false;
    const file = firstFile(asset);
    return !!file && VISUAL_EXT.test(file);
  }

  function complicationSegments(assets, comp, env, med) {
    const found = new Set();
    for (const a of assets || []) {
      if (!COMPLICATION_ROLES.includes(a.role)) continue;
      if (!hits(tagsOf(a).complication, [comp])) continue;
      if (!allows(tagsOf(a).environment, env) || !allows(tagsOf(a).medicalEvent, med)) continue;
      found.add(segmentOf(a));
    }
    return found.size ? [...found].sort((a, b) => a - b) : [1];
  }

  /**
   * 這個突發狀況在此環境×急救事件下，到底演不演得出來。
   * ok=false 代表勾了也不會有任何東西出現——那種選項不該讓人選得到。
   */
  function complicationAvailability(assets, comp, env, med) {
    const segments = complicationSegments(assets, comp, env, med).filter(segment => {
      const videos = eligibleAssets(assets, 'complication_video',
        { env, med, comps: [comp], segment });
      return videos.some(projectableComplication);
    });
    return { comp, segments, ok: segments.length > 0 };
  }

  function availableComplications(assets, options, env, med) {
    return asArray((options || {}).complication)
      .map(comp => complicationAvailability(assets, comp, env, med));
  }

  /** 四個基本角色在這格的狀態：ok＝有素材、none＝刻意留白、missing＝查無 */
  function baseCoverage(assets, env, med) {
    const out = {};
    let photo = null;
    for (const role of BASE_ROLES) {
      const list = eligibleAssets(assets, role, { env, med, comps: [], patientPhoto: photo });
      if (role === 'patient_photo' && list.length) photo = list[0];
      out[role] = !list.length ? 'missing'
        : (list.every(a => a.type === 'none') ? 'none' : 'ok');
    }
    return out;
  }

  /** 整張覆蓋表：環境 × 急救事件，供選單標示與素材頁使用 */
  function coverageMatrix(assets, options) {
    const sets = optionSets(options);
    const rows = [];
    for (const env of sets.environments) {
      for (const med of sets.medicalEvents) {
        const base = baseCoverage(assets, env, med);
        const comps = availableComplications(assets, options, env, med);
        rows.push({
          environment: env,
          medicalEvent: med,
          base,
          missing: BASE_ROLES.filter(r => base[r] === 'missing'),
          complications: comps.filter(c => c.ok).map(c => c.comp),
        });
      }
    }
    return rows;
  }

  return {
    ACTION_TYPES,
    BASE_ROLES,
    COMPLICATION_ROLES,
    optionSets,
    specificity,
    segmentOf,
    eligibleAssets,
    projectableComplication,
    complicationSegments,
    complicationAvailability,
    availableComplications,
    baseCoverage,
    coverageMatrix,
    complicationsOf,
    playableSlides,
    normalizeScenarios,
    mergeScenarios,
    forExport,
    exportYaml,
    parseImport,
    fromPreset,
  };
});
