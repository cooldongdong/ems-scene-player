// 情境檔的 Node 端載入 —— 給測試與 tools/build-scenarios-index.js 共用。
//
// 為什麼要有這一支：拆成 scenarios/ 之後，「有哪些情境」這個問題有兩個答案，
// 而它們的權威性**不一樣**：
//
//   資料夾裡實際有的檔  ← 真相
//   scenarios/index.yaml ← 真相的副本，因為純靜態網站沒辦法列目錄，只好抄一份
//
// 所以 Node 這一端（測試、產生 index）一律掃資料夾，**不讀 index.yaml**。
// 讀了就會變成「用副本去驗證副本」，index 漏一筆時測試跟著漏，那道防線等於沒有。
// index.yaml 只有瀏覽器讀，因為它沒有別的選擇。
//
// 這也是測試不檢查 index 新鮮度的原因：COO-86 的教官送 PR 時只能新增一個檔
// （GitHub 的預填網址是單檔編輯器），他的 index 依定義就是舊的。若 PR 檢查因此變紅，
// 那條貢獻路線整條廢掉。index 的新鮮度由 merge 之後的 workflow 負責。

const fs = require('node:fs');
const path = require('node:path');

const yaml = require('../vendor/js-yaml.min.js');

const DIR_NAME = 'scenarios';
const INDEX_NAME = 'index.yaml';

function scenariosDir(root) {
  return path.join(root, DIR_NAME);
}

/** 資料夾裡實際有哪些情境檔（排序後，這就是清單順序）。index.yaml 本身不算。 */
function listScenarioFiles(root) {
  const dir = scenariosDir(root);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(name => /\.ya?ml$/i.test(name) && name !== INDEX_NAME)
    .sort();
}

/** 掃資料夾讀出所有情境（未正規化的原始物件），順序同 listScenarioFiles */
function loadScenarios(root) {
  return listScenarioFiles(root).map(name => {
    const text = fs.readFileSync(path.join(scenariosDir(root), name), 'utf8');
    return { file: name, scenario: yaml.load(text) };
  });
}

module.exports = { DIR_NAME, INDEX_NAME, scenariosDir, listScenarioFiles, loadScenarios };
