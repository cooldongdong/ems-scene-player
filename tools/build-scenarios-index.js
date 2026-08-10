// 產生 scenarios/index.yaml —— 純靜態網站列不出目錄，只好把檔名抄一份給瀏覽器。
//
//     node tools/build-scenarios-index.js           重新產生
//     node tools/build-scenarios-index.js --check   只檢查有沒有過期（過期就 exit 1）
//
// 什麼時候要跑：**本機新增或刪除情境檔之後**。改情境內容不用跑，加素材、改程式也不用跑。
// GitHub 上不用跑——push 到 main 之後 .github/workflows/scenarios-index.yml 會自己跑。

const fs = require('node:fs');
const path = require('node:path');

const { INDEX_NAME, scenariosDir, listScenarioFiles } = require('./load-scenarios.js');

const ROOT = path.join(__dirname, '..');

const HEADER = [
  '# 自動產生，不要手改。',
  '#',
  '# 這是 scenarios/ 資料夾的檔案清單。純靜態網站沒有辦法問伺服器「這個資料夾裡有什麼」',
  '# （HTTP 沒有這個動詞），所以首頁只能照著這張清單一個一個去抓。',
  '#',
  '# 真相是資料夾本身，這裡是副本。手改這個檔只會讓兩邊分岔——',
  '# 本機請跑 node tools/build-scenarios-index.js，GitHub 上由 workflow 自動重產。',
  '',
].join('\n');

function render(files) {
  return HEADER + 'files:\n' + files.map(f => `  - ${f}\n`).join('');
}

function main() {
  const files = listScenarioFiles(ROOT);
  const target = path.join(scenariosDir(ROOT), INDEX_NAME);
  const next = render(files);
  const current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : null;

  if (process.argv.includes('--check')) {
    if (current === next) {
      console.log(`scenarios/${INDEX_NAME} 是最新的（${files.length} 個情境）`);
      return;
    }
    console.error(`scenarios/${INDEX_NAME} 已過期，請跑：node tools/build-scenarios-index.js`);
    process.exit(1);
  }

  if (current === next) {
    console.log(`scenarios/${INDEX_NAME} 無變動（${files.length} 個情境）`);
    return;
  }
  fs.writeFileSync(target, next);
  console.log(`已更新 scenarios/${INDEX_NAME}（${files.length} 個情境）`);
}

main();
