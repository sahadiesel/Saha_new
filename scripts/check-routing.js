
const fs = require('fs');
const path = require('path');

const projectRoot = process.cwd();
const errors = [];

function logError(message) {
  console.error(`❌ ${message}`);
  errors.push(message);
}

function logWarning(message) {
  console.warn(`⚠️ ${message}`);
}

console.log('Running routing sanity checks...');

// --- Check 1: Prevent Next.js 15 Route Conflicts between root app/ and src/app/ ---
const srcAppDir = path.join(projectRoot, 'src', 'app');
if (fs.existsSync(srcAppDir)) {
  const files = findFiles(srcAppDir, /(page|layout)\.tsx$/);
  if (files.length > 0) {
    // Next.js 15 will fail build if both app/ and src/app/ exist with functional pages.
    logError('Route Conflict Detected: Project contains functional routes in "src/app". All routes must be moved to the root "app/" directory to avoid Next.js 15 build failure.');
  }
}

// --- Helper to find files recursively ---
function findFiles(startPath, filter, fileList = []) {
  if (!fs.existsSync(startPath)) {
    return fileList;
  }
  const files = fs.readdirSync(startPath);
  for (const file of files) {
    const filename = path.join(startPath, file);
    const stat = fs.lstatSync(filename);
    if (stat.isDirectory()) {
      findFiles(filename, filter, fileList);
    } else if (filter.test(filename)) {
      fileList.push(filename);
    }
  }
  return fileList;
}

// --- Check 2: Infinite loops in re-exports ---
const allPageFiles = findFiles(path.join(projectRoot, 'app'), /(page|layout)\.tsx$/);

for (const filePath of allPageFiles) {
  const content = fs.readFileSync(filePath, 'utf8');
  const relativePath = path.relative(projectRoot, filePath).replace(/\\/g, '/');

  const selfExportRegex = /export\s*{\s*default\s*}\s*from\s*["']@\/(.*?)["']/;
  const match = content.match(selfExportRegex);
  if (match) {
      const importPath = match[1].replace(/\..*$/, '');
      const currentFilePath = relativePath.replace(/^src\//, '').replace(/\..*$/, '');
      if (importPath === currentFilePath) {
          logError(`Self Re-export Error: File "${relativePath}" is re-exporting itself from alias "@/${importPath}". This creates an infinite loop.`);
      }
  }
}

if (errors.length > 0) {
  console.error(`\nFound ${errors.length} critical routing error(s). Please fix them before building.`);
  process.exit(1);
}

console.log('✅ Routing structure check passed.');
