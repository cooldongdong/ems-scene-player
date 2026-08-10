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

  // 一頁 = 一組疊起來的圖層，宣告「這頁畫面上有什麼」。
  //
  // 順序就是這個陣列的順序，也就是投影視窗寫死的 z-index：
  //   #projection-stage(底) < patient-layer(1) < complication-layer(2) < projection-text(3)
  // （#projection-message 不是圖層，是「素材找不到」那種全螢幕告示，另外壓在最上面）
  // 所以圖層**不能自由調上下**——順序由型別決定。要改得先重寫 renderer 的層管理。
  // 曾經有一個 sound 型別，2026-08-09 移除：它存得進來也匯得出去，但播放程式碼
  // 從來沒有讀過它——按下「＋ 聲音」只會得到一個永遠不會響的圖層。聲音改走
  // 「一個突發狀況一個聲音」（綠幕是影片就用原聲，否則用配音檔），那條路在媒體池裡。
  const LAYER_TYPES = ['scene', 'patient', 'greenscreen', 'text'];

  // 環境影像與病患照片是「選完情境就決定」的東西，編輯時換不掉，所以每頁必備、不可刪。
  // normalizeSlide 會替沒寫的頁自動補上；編輯器也不給這兩層刪除鍵。
  const ALWAYS_ON_LAYERS = ['scene', 'patient'];

  // 每種圖層的版面預設值。normalize 會補齊，forExport 只寫非預設值——
  // 否則每個情境檔都會被 size/x/y/tolerance 灌滿，手改時看不出哪裡真的動過。
  const LAYER_DEFAULTS = {
    scene: {},
    patient: { size: 85, x: 50, y: 57 },
    greenscreen: { size: 70, x: 50, y: 55, tolerance: 40 },
    text: { size: 40, x: 50, y: 50 },
  };

  // 與主畫面滑桿的 min/max 一致；超出範圍的值會被夾回來而不是整層丟掉
  const LAYER_RANGES = { size: [10, 100], x: [0, 100], y: [0, 100], tolerance: [5, 60] };

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

  // 圖層看不看得見。散在各處寫 `layer.visible !== false` 遲早有人漏一處，
  // 而漏掉的那一處通常是投影端——教官藏起來的東西還投在學員面前。
  function layerVisible(layer) {
    return !!layer && layer.visible !== false;
  }

  // 說明文字的定位模型。**預覽與投影都必須讀這一份。**
  // x/y 是「文字方塊中心點佔舞台寬高的百分比」，與 placePreviewItem 對圖片用的
  // 那一套完全相同；size/10 是字級佔舞台寬度的百分比。差別只在單位——預覽的舞台
  // 不是視窗，要用容器單位 cqw，投影的舞台就是視窗，用 vw。
  // 兩邊各寫一次的下場實測過：投影端曾經是 left:0 + place-items:center（x 根本沒用到）
  // 配 top:(y-50)%（y 也不是中心點），拖出來的位置跟投影對不上，而且沒有任何地方會報錯。
  function textBoxStyle(layer, unit) {
    if (!layer) return null;
    const def = LAYER_DEFAULTS.text;
    const num = (v, d) => (Number.isFinite(v) ? v : d);
    return {
      left: num(layer.x, def.x) + '%',
      top: num(layer.y, def.y) + '%',
      fontSize: num(layer.size, def.size) / 10 + unit,
    };
  }

  // 取某一頁的某種圖層（每種型別一頁最多一個，見 normalizeSlide）
  function layerOf(slide, type) {
    return asArray(slide && slide.layers).find(l => l.type === type) || null;
  }

  // 情境用到哪些突發狀況 = 所有「啟用中」的簡報頁的 greenscreen 圖層的聯集。
  // 不另外存欄位：存了就是第二份真相，遲早出現「勾了但沒有任何一頁用到」的矛盾。
  function complicationsOf(scenario) {
    const seen = [];
    for (const slide of asArray(scenario && scenario.slides)) {
      if (slide.enabled === false) continue;
      const layer = layerOf(slide, 'greenscreen');
      if (layer && layer.complication && !seen.includes(layer.complication)) {
        seen.push(layer.complication);
      }
    }
    return seen;
  }

  // 播放時實際會走到的頁；enabled === false 的頁跳過，但仍留在清單裡供人打開
  function playableSlides(scenario) {
    return asArray(scenario && scenario.slides).filter(s => s.enabled !== false);
  }

  // ---------- 驗證與正規化 ----------

  // 數值超出滑桿範圍就夾回來，不是整層丟掉——手改 YAML 打錯一個數字
  // 不該讓整頁消失，那太難查。
  function clampField(value, key, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    const [min, max] = LAYER_RANGES[key];
    return Math.max(min, Math.min(max, Math.round(n)));
  }

  // 一組版面值（size/x/y…）的正規化：缺的補預設、超出範圍的夾回來
  function normalizeLayout(raw, defaults) {
    const src = isObject(raw) ? raw : {};
    const out = {};
    for (const key of Object.keys(defaults)) out[key] = clampField(src[key], key, defaults[key]);
    return out;
  }

  function normalizeLayer(layer, sets, where, warn) {
    if (!isObject(layer)) {
      warn(`${where} 的圖層不是物件，已跳過`);
      return null;
    }
    const type = trimmed(layer.type);
    if (!LAYER_TYPES.includes(type)) {
      warn(`${where} 的圖層型別「${layer.type}」不支援（只有 ${LAYER_TYPES.join('／')}），已跳過`);
      return null;
    }

    const out = { type };

    if (type === 'greenscreen') {
      const comp = trimmed(layer.complication);
      if (!comp) {
        warn(`${where} 的 greenscreen 圖層沒有指定突發狀況，已跳過`);
        return null;
      }
      if (sets.complications.length && !sets.complications.includes(comp)) {
        warn(`${where} 的突發狀況「${comp}」不在 options 內，已跳過`);
        return null;
      }
      out.complication = comp;
      // segment 省略 = 該狀況的第一段；填了就釘那一段
      if (layer.segment !== undefined && layer.segment !== null && layer.segment !== '') {
        out.segment = String(layer.segment);
      }
    }

    if (type === 'text') {
      const text = trimmed(layer.text);
      if (!text) {
        warn(`${where} 的 text 圖層沒有內容，已跳過`);
        return null;
      }
      out.text = text;
    }

    // 釘選素材：auto（不填）＝依情境條件挑，重新產生會換；填了就永遠是這一筆。
    // id 對不對這裡不檢查——資料層看不到素材庫，交給呼叫端在挑素材時處理。
    if (trimmed(layer.asset)) out.asset = trimmed(layer.asset);

    // 顯示／隱藏。**與「刪除」是兩件事**：刪除是「這頁不要這個東西」，隱藏是
    // 「這一刻先不要看到」。scene 與 patient 是必備圖層、刪不掉，所以要暫時把病患
    // 收起來只看場景，只有這條路。預設 true，只有明確寫 false 才算隱藏。
    if (layer.visible === false) out.visible = false;

    const defaults = LAYER_DEFAULTS[type];
    for (const key of Object.keys(defaults)) {
      out[key] = clampField(layer[key], key, defaults[key]);
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

    const seen = new Set();
    const layers = [];
    for (const raw of asArray(slide.layers)) {
      const layer = normalizeLayer(raw, sets, label, warn);
      if (!layer) continue;
      // 一頁每種型別最多一個：greenscreen 是 renderer 的硬限制（一次只有一個 canvas），
      // 其餘是刻意簡化——疊兩張病患照沒有人要，卻會讓編輯器多一整層複雜度。
      if (seen.has(layer.type)) {
        warn(`${label} 有多個 ${layer.type} 圖層，只保留第一個`);
        continue;
      }
      seen.add(layer.type);
      layers.push(layer);
    }
    if (!layers.length) {
      warn(`${label} 沒有任何有效圖層，已跳過`);
      return null;
    }
    // 環境影像與病患照片由情境決定（編輯時不能換素材），所以每一頁都有這兩層。
    // 沒寫就自動補上，手寫 YAML 才不必每頁重複抄一樣的兩行。
    for (const type of ALWAYS_ON_LAYERS) {
      if (!seen.has(type)) layers.push({ type, ...LAYER_DEFAULTS[type] });
    }
    // 排成固定的 z 順序，資料裡的順序不影響輸出——避免有人以為調換陣列就能改上下層
    layers.sort((a, b) => LAYER_TYPES.indexOf(a.type) - LAYER_TYPES.indexOf(b.type));

    const out = {
      id,
      title: trimmed(slide.title) || `第 ${index + 1} 頁`,
      // 只有明確寫 false 才是關閉；沒寫視為啟用，這樣手寫 YAML 不必每頁都補 enabled
      enabled: slide.enabled !== false,
      layers,
    };
    // 給教官看的提詞，不投影。與 text 圖層是兩件事，混掉會把提詞投到大螢幕上。
    if (trimmed(slide.note)) out.note = trimmed(slide.note);
    return out;
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
    // 環境聲音放情境層級而不是頁圖層：它是唯一會 loop 的角色
    // （index.html：el.loop = asset.role === 'ambient_sound'），
    // 做成頁圖層的話每換一頁就從頭重播，現場聽起來會像斷掉。
    // 'auto'（預設）＝依情境條件挑；'none'＝這場不要環境聲音；其餘視為素材 id。
    out.ambience = trimmed(scenario.ambience) || 'auto';
    // 病患在畫面上的預設位置，放情境層而不是每頁各自預設：同一場訓練裡病患不會換位置，
    // **新增一頁時應該直接站在對的地方**，而不是回到全域預設再手動拖一次。
    // 只影響「新的頁」與「歸位」——已存在的頁各自的值仍存在自己的圖層上，不會被追溯改動。
    out.patientHome = normalizeLayout(scenario.patientHome, LAYER_DEFAULTS.patient);
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
      if (s.ambience && s.ambience !== 'auto') out.ambience = s.ambience;
      // 跟全域預設一樣就不寫，維持「手改時只看到真的動過的東西」
      const home = s.patientHome || {};
      if (Object.keys(LAYER_DEFAULTS.patient).some(k => home[k] !== LAYER_DEFAULTS.patient[k])) {
        out.patientHome = { ...home };
      }
      out.slides = asArray(s.slides).map(slide => {
        const o = { id: slide.id, title: slide.title };
        // enabled: true 是預設值，不寫進匯出檔，讓人手改時看到的是最小差異
        if (slide.enabled === false) o.enabled = false;
        if (slide.note) o.note = slide.note;
        o.layers = asArray(slide.layers).map(layer => {
          const l = { type: layer.type };
          if (layer.complication) l.complication = layer.complication;
          if (layer.segment) l.segment = layer.segment;
          if (layer.text) l.text = layer.text;
          if (layer.asset) l.asset = layer.asset;
          if (layer.visible === false) l.visible = false;   // 預設顯示，只寫隱藏的
          // 只寫跟預設不一樣的版面值，否則每個檔都會被 size/x/y/tolerance 灌滿
          const defaults = LAYER_DEFAULTS[layer.type] || {};
          for (const key of Object.keys(defaults)) {
            if (layer[key] !== undefined && layer[key] !== defaults[key]) l[key] = layer[key];
          }
          return l;
        });
        return o;
      });
      return out;
    });
  }

  /**
   * 匯出**一個**情境，成為可以直接放進 scenarios/ 的檔案內容。
   *
   * 為什麼是單一情境而不是整包：匯出檔要能被 review、能被 PR 進來（COO-86），
   * 而「一個檔一個情境」讓這件事變成「新增一個檔」。整包匯出的話，貢獻者送出的是
   * 一份包含別人情境的大檔，diff 全是雜訊，沒有人 review 得動。
   *
   * 所以這裡**不包 `scenarios:` 那一層**——檔案的內容就是情境本身，
   * 跟 scenarios/ 裡的檔一模一樣，貼進去就能用。
   *
   * @param dump 由呼叫端注入的 jsyaml.dump，這一層不綁任何 yaml 實作
   */
  function exportScenarioYaml(scenario, dump) {
    return dump(forExport([scenario])[0], { lineWidth: -1, noRefs: true });
  }

  // 匯入時能接受的三種形狀。單一情境是現在匯出的形狀，另外兩種是為了讓舊的匯出檔
  // 與手貼的 scenario-data.yaml 片段還進得來——匯入是別人給你的檔，不能只認自己寫的格式。
  function importCandidates(data) {
    if (Array.isArray(data)) return data;
    if (!isObject(data)) return null;
    if (Array.isArray(data.scenarios)) return data.scenarios;
    if (data.slides !== undefined) return [data];
    return null;
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
    const raw = importCandidates(data);
    if (!raw) {
      return {
        scenarios: [],
        warnings: ['檔案裡找不到情境（要嘛是單一個情境，要嘛是 scenarios 陣列）'],
        ok: false,
      };
    }
    const result = normalizeScenarios(raw, options);
    return { ...result, ok: true };
  }

  // ---------- id ----------
  // id 是這個情境的身分：localStorage 靠它比對「自訂覆蓋內建」，匯出與送 PR 靠它當檔名。
  // 以前它只由程式產生（custom-1、custom-2），人改不到，於是那個既不描述內容、
  // 又只在一台電腦裡唯一的字串一路流到了檔名——所以現在讓人改，也因此需要驗證。

  const ID_PATTERN = /^[a-z][a-z0-9-]*$/;
  const ID_MAX = 60;

  /**
   * id 有沒有問題。回傳 null＝可以用，否則回傳一句給人看的話。
   * @param taken 已經被佔走的 id（其他情境、scenarios/ 裡的檔名）
   */
  function scenarioIdProblem(id, taken) {
    const value = trimmed(id);
    if (!value) return 'id 不能空白';
    if (value.length > ID_MAX) return `id 太長了（最多 ${ID_MAX} 個字）`;
    // 這條規則不是潔癖：id 會變成 scenarios/<id>.yaml 的檔名，也會進網址
    if (!ID_PATTERN.test(value)) {
      return 'id 只能用小寫英數字與連字號，且要以英文字母開頭（例：home-ohca-night）';
    }
    if (asArray(taken).includes(value)) return `id「${value}」已經有人用了`;
    return null;
  }

  /**
   * 複製時的新 id：從原本那個長出來，而不是回到 custom-N。
   * `home-ohca` → `home-ohca-copy` → `home-ohca-copy-2`……
   * 一眼看得出是從哪一個複製的，這在之後要送 PR 時特別有用。
   */
  function copyScenarioId(baseId, taken) {
    const list = asArray(taken);
    const base = `${trimmed(baseId) || 'scenario'}-copy`;
    if (!list.includes(base)) return base;
    let n = 2;
    while (list.includes(`${base}-${n}`)) n++;
    return `${base}-${n}`;
  }

  // ---------- 貢獻（送 PR）----------
  // COO-86：讓不會 git 的教官把編好的情境送成 PR。走 GitHub 的「新增檔案」預填網址，
  // 開過去就是一個內容已經填好的網頁編輯器，按 "Propose new file" 就送出 PR——
  // 不需要 OAuth、不需要後端。（真正的替代方案 OAuth + GitHub API 要 client secret，
  // 靜態網站放不了，所以這是唯一走得通的路。）
  //
  // 那個編輯器**一次只能新增一個檔**，這正是情境必須拆成 scenarios/ 的原因（COO-84）：
  // 貢獻＝新增一個檔，中途不必碰 index、不必懂 branch。

  /** 情境檔在 repo 裡的路徑。匯出、送 PR、index.yaml 共用同一條規則 */
  function scenarioPath(id) {
    return `scenarios/${id}.yaml`;
  }

  /**
   * GitHub 的網頁編輯器網址。兩種動詞，**但只有一種吃得下預填**：
   *
   *   new   `/new/{branch}?filename=…&value=…`   新增一個檔。**預填成立**（2026-08-10 實測）
   *   edit  `/edit/{branch}/{path}`              改既有的檔。**`?value=` 無效**——
   *                                              2026-08-10 實測 `/edit/main/dev.md?value=X`
   *                                              開出來仍是原本的 dev.md，參數被忽略
   *
   * 所以修正那條路沒辦法把內容塞進網址，只能把內容放進剪貼簿、讓人到那邊貼上。
   * 呼叫端要負責複製，不然使用者會對著原檔一頭霧水（見 index.html 的 contributeFix）。
   *
   * 為什麼不乾脆兩種都走 new：`/new/` 指向一個已經存在的路徑，GitHub 會在送出時
   * 擋下來說「這個檔名已經存在」——那比多貼一次更糟，因為錯誤發生在最後一步。
   *
   * 走哪一種不需要問使用者——**他改的是不是既有情境，資料裡就寫著**（source）。
   * review 端的差別才是重點：new 送出的是「多一個檔」，review 的人得自己比對它跟
   * 哪一個情境九成像；edit 送出的是那個檔的 diff，一眼看得出改了哪一句台詞。
   *
   * @param mode 'new'（預設）或 'edit'
   * @param dump 由呼叫端注入的 jsyaml.dump（mode 為 edit 時用不到）
   */
  function contributionUrl(scenario, { repo, branch = 'main', dump, mode = 'new' }) {
    const path = scenarioPath(scenario.id);
    const at = encodeURIComponent(branch);
    if (mode === 'edit') {
      // 路徑是網址的一部分，斜線要留著當分隔，只 encode 各段
      const encodedPath = path.split('/').map(encodeURIComponent).join('/');
      return `https://github.com/${repo}/edit/${at}/${encodedPath}`;
    }
    return `https://github.com/${repo}/new/${at}`
      + `?filename=${encodeURIComponent(path)}`
      + `&value=${encodeURIComponent(exportScenarioYaml(scenario, dump))}`;
  }

  // ---------- actions 模型 → 圖層模型 ----------

  /**
   * 把舊的 actions 模型轉成圖層模型。
   *
   * 核心規則：**一個舊「步驟」＝一個新「頁」**。
   * 舊模型一頁可以有多個 action，而多片段的突發狀況在執行期還會再被拆成多步
   * （index.html 的 buildFlowSteps）。那個展開是隱式的、使用者看不到也改不了；
   * 搬到資料層之後每一段都成為真正的一頁，可以改標題、關掉、排序、加說明文字。
   *
   * 因此遷移後的頁數必然等於遷移前的步驟數——這也是驗收的第一條。
   *
   * @param assets 需要素材庫才知道某個突發狀況有幾段
   */
  function migrateScenario(scenario, assets, options) {
    if (!isObject(scenario)) return scenario;
    // 已經是圖層模型就原樣返回，重複跑不會壞
    if (asArray(scenario.slides).some(s => isObject(s) && s.layers)) return scenario;

    const env = trimmed(scenario.environment);
    const med = trimmed(scenario.medicalEvent);
    const slides = [];

    for (const old of asArray(scenario.slides)) {
      if (!isObject(old)) continue;
      const enabled = old.enabled !== false;
      const title = trimmed(old.title) || '未命名';

      // 先把這一頁展開成「步驟」，再一步一頁
      const steps = [];
      for (const action of asArray(old.actions)) {
        if (!isObject(action)) continue;
        if (action.type === 'wait') {
          steps.push({ wait: true, note: trimmed(action.note) });
          continue;
        }
        const comp = trimmed(action.complication);
        if (action.type !== 'complication' || !comp) continue;
        const pinned = action.segment !== undefined && action.segment !== null && action.segment !== '';
        const segs = pinned
          ? [String(action.segment)]
          : complicationSegments(assets, comp, env, med).map(String);
        segs.forEach((segment, i) => steps.push({
          comp, segment, part: segs.length > 1 ? `${i + 1}/${segs.length}` : '',
        }));
      }

      for (const step of steps) {
        const slide = {
          id: `s${slides.length + 1}`,
          title: step.part ? `${title}（${step.part}）` : title,
          enabled,
          // 場景永遠在最底層；病患照片改為預設就在畫面上——
          // 舊版的「疊加到投影視窗」開關預設關閉、每次都要手動打開，
          // 圖層模型下「有沒有這一層」就是那個開關，不需要另一個勾選框。
          layers: [{ type: 'scene' }, { type: 'patient' }],
        };
        if (step.wait) {
          if (step.note) slide.note = step.note;
        } else {
          const layer = { type: 'greenscreen', complication: step.comp };
          // 只有真的多段時才釘 segment。單段的釘上去只是噪音，
          // 而這個檔案要給人手改、之後還要能 PR 貢獻。
          if (step.part) layer.segment = step.segment;
          slide.layers.push(layer);
        }
        slides.push(slide);
      }
    }

    const out = { ...scenario, slides };
    delete out.actions;
    return out;
  }

  function migrateScenarios(raw, assets, options) {
    return asArray(raw).map(s => migrateScenario(s, assets, options));
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
    LAYER_TYPES,
    ALWAYS_ON_LAYERS,
    LAYER_DEFAULTS,
    LAYER_RANGES,
    layerOf,
    layerVisible,
    textBoxStyle,
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
    exportScenarioYaml,
    parseImport,
    scenarioIdProblem,
    copyScenarioId,
    scenarioPath,
    contributionUrl,
    migrateScenario,
    migrateScenarios,
  };
});
